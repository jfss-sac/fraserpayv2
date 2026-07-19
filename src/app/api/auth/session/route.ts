import "server-only";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { ForbiddenError, InternalError, UnauthorizedError } from "@/lib/server/errors";
import { getAdminAuth, getAdminFirestore } from "@/lib/server/firebase-admin";
import { defineHandler } from "@/lib/server/http";
import { generatePaymentCode } from "@/lib/server/paymentCode";
import { SCHOOL_DOMAIN, SESSION_COOKIE_NAME, SESSION_TTL_MS } from "@/lib/shared/constants";

const schema = z.object({ idToken: z.string().min(1) });

export function studentNumberFromEmail(email: string): string | null {
  const localPart = email.split("@")[0] ?? "";
  return /^[0-9]+$/.test(localPart) ? localPart : null;
}

function serializeSessionCookie(value: string): string {
  return [
    `${SESSION_COOKIE_NAME}=${value}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ].join("; ");
}

async function uniquePaymentCode(): Promise<string> {
  const users = getAdminFirestore().collection("users");
  for (;;) {
    const code = generatePaymentCode();
    if ((await users.where("paymentCode", "==", code).limit(1).get()).empty) return code;
  }
}

async function provisionUser(token: DecodedIdToken, email: string): Promise<void> {
  const db = getAdminFirestore();
  const userRef = db.collection("users").doc(token.uid);
  if ((await userRef.get()).exists) return;

  const displayName = token.name ?? email.split("@")[0] ?? email;
  const paymentCode = await uniquePaymentCode();
  const pendingRef = db.collection("pendingRoleGrants").doc(email);

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(userRef);
    if (existing.exists) return;

    const pending = await tx.get(pendingRef);
    const pendingRoles = (pending.data()?.roles ?? {}) as {
      sacMember?: boolean;
      sacExec?: boolean;
    };

    tx.set(userRef, {
      email,
      displayName,
      displayNameLower: displayName.toLowerCase(),
      studentNumber: studentNumberFromEmail(email),
      paymentCode,
      balanceCents: 0,
      points: 0,
      roles: {
        sacMember: pendingRoles.sacMember === true,
        sacExec: pendingRoles.sacExec === true,
      },
      suspended: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (pending.exists) tx.delete(pendingRef);
  });
}

export const POST = defineHandler(
  { role: "public", schema, rateLimit: "auth-session" },
  async ({ input }) => {
    const auth = getAdminAuth();

    let token: DecodedIdToken;
    try {
      token = await auth.verifyIdToken(input.idToken);
    } catch {
      throw new UnauthorizedError("Could not verify your Google sign-in.");
    }

    const email = token.email?.toLowerCase() ?? "";
    if (!token.email_verified || !email.endsWith(`@${SCHOOL_DOMAIN}`)) {
      throw new ForbiddenError(
        `Use your @${SCHOOL_DOMAIN} school Google account — personal accounts can't sign in.`,
      );
    }

    await provisionUser(token, email);

    let cookie: string;
    try {
      cookie = await auth.createSessionCookie(input.idToken, { expiresIn: SESSION_TTL_MS });
    } catch {
      throw new InternalError();
    }

    const response = Response.json({ ok: true });
    response.headers.append("set-cookie", serializeSessionCookie(cookie));
    return response;
  },
);
