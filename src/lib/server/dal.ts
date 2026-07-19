import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import type { DecodedIdToken } from "firebase-admin/auth";
import { ForbiddenError, InternalError, SuspendedError, UnauthorizedError } from "./errors";
import { getAdminAuth, getAdminFirestore } from "./firebase-admin";
import { logger } from "./logger";
import { SESSION_COOKIE_NAME } from "@/lib/shared/constants";

export type Role = "public" | "session" | "active" | "sacMember" | "sacExec" | "boothMember";

export interface Session {
  uid: string;
  email: string;
  displayName: string;
  studentNumber: string | null;
  balanceCents: number;
  points: number;
  roles: { sacMember: boolean; sacExec: boolean };
  suspended: boolean;
}

function cookieFromHeader(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function toSession(decoded: DecodedIdToken, data: FirebaseFirestore.DocumentData): Session {
  const roles = (data.roles ?? {}) as { sacMember?: boolean; sacExec?: boolean };
  return {
    uid: decoded.uid,
    email: (data.email as string | undefined) ?? decoded.email ?? "",
    displayName: (data.displayName as string | undefined) ?? "",
    studentNumber: (data.studentNumber as string | null | undefined) ?? null,
    balanceCents: (data.balanceCents as number | undefined) ?? 0,
    points: (data.points as number | undefined) ?? 0,
    roles: { sacMember: roles.sacMember === true, sacExec: roles.sacExec === true },
    suspended: data.suspended === true,
  };
}

const resolveSessionFromCookie = cache(
  async (cookieValue: string | undefined, checkRevoked: boolean): Promise<Session | null> => {
    if (!cookieValue) return null;
    let decoded: DecodedIdToken;
    try {
      decoded = await getAdminAuth().verifySessionCookie(cookieValue, checkRevoked);
    } catch {
      return null;
    }
    const snap = await getAdminFirestore().collection("users").doc(decoded.uid).get();
    const data = snap.data();
    if (!data) return null;
    return toSession(decoded, data);
  },
);

const isBoothMember = cache(async (boothId: string, uid: string): Promise<boolean> => {
  const snap = await getAdminFirestore()
    .collection("booths")
    .doc(boothId)
    .collection("members")
    .doc(uid)
    .get();
  return snap.exists;
});

export const hasAnyBoothMembership = cache(async (uid: string): Promise<boolean> => {
  try {
    const snap = await getAdminFirestore()
      .collectionGroup("members")
      .where("uid", "==", uid)
      .limit(1)
      .get();
    return !snap.empty;
  } catch (err) {
    logger.warn({ event: "booth-membership-check-failed", actorUid: uid, err });
    return false;
  }
});

function assertSession(session: Session | null): asserts session is Session {
  if (!session) throw new UnauthorizedError();
}

function assertActive(session: Session | null): asserts session is Session {
  assertSession(session);
  if (session.suspended) throw new SuspendedError();
}

function assertSacMember(session: Session | null): asserts session is Session {
  assertActive(session);
  if (!session.roles.sacMember && !session.roles.sacExec) throw new ForbiddenError();
}

function assertSacExec(session: Session | null): asserts session is Session {
  assertActive(session);
  if (!session.roles.sacExec) throw new ForbiddenError();
}

export const getSession = cache(async (): Promise<Session | null> => {
  const cookieValue = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return resolveSessionFromCookie(cookieValue, false);
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  assertSession(session);
  return session;
}

export async function requireActive(): Promise<Session> {
  const session = await getSession();
  assertActive(session);
  return session;
}

export async function requireSacMember(): Promise<Session> {
  const session = await getSession();
  assertSacMember(session);
  return session;
}

export async function requireSacExec(): Promise<Session> {
  const session = await getSession();
  assertSacExec(session);
  return session;
}

export async function requireBoothMember(boothId: string): Promise<Session> {
  const session = await requireActive();
  if (!(await isBoothMember(boothId, session.uid))) {
    throw new ForbiddenError("You are not a member of this booth.");
  }
  return session;
}

function isMutation(method: string): boolean {
  const m = method.toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}

export async function authorizeRequest(
  role: Role,
  request: Request,
  boothId?: string,
): Promise<Session | null> {
  if (role === "public") return null;

  const cookieValue = cookieFromHeader(request.headers.get("cookie"));
  const session = await resolveSessionFromCookie(cookieValue, isMutation(request.method));

  switch (role) {
    case "session":
      assertSession(session);
      return session;
    case "active":
      assertActive(session);
      return session;
    case "sacMember":
      assertSacMember(session);
      return session;
    case "sacExec":
      assertSacExec(session);
      return session;
    case "boothMember":
      assertActive(session);
      if (!boothId) throw new InternalError();
      if (!(await isBoothMember(boothId, session.uid))) {
        throw new ForbiddenError("You are not a member of this booth.");
      }
      return session;
  }
}
