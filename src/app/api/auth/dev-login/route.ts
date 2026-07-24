import "server-only";
import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuth } from "@/lib/server/firebase-admin";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "@/lib/shared/constants";

function devLoginEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_USE_EMULATORS === "true" &&
    Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST)
  );
}

async function mintSessionCookie(uid: string): Promise<string> {
  const auth = getAdminAuth();
  const customToken = await auth.createCustomToken(uid);
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=emulator`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const body = (await res.json()) as { idToken?: string };
  if (!res.ok || !body.idToken) {
    throw new Error(`emulator custom-token exchange failed (${res.status})`);
  }
  return auth.createSessionCookie(body.idToken, { expiresIn: SESSION_TTL_MS });
}

function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/sell";
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!devLoginEnabled()) notFound();

  const uid = request.nextUrl.searchParams.get("uid") ?? "seed-student-ava";
  const next = safeNext(request.nextUrl.searchParams.get("next"));

  const cookie = await mintSessionCookie(uid);
  const response = NextResponse.redirect(new URL(next, request.nextUrl));
  response.cookies.set(SESSION_COOKIE_NAME, cookie, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return response;
}
