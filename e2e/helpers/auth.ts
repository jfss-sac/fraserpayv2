import { type Page, expect } from "@playwright/test";
import { SESSION_COOKIE_NAME } from "../../src/lib/shared/constants";
import { createEmulatorUser, emulatorIdToken, mintSessionCookie } from "./firebase";

export const SIGNED_OUT_STATE = { cookies: [], origins: [] };

export async function signInAs(page: Page, uid: string): Promise<void> {
  const cookie = await mintSessionCookie(uid);
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: cookie,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

export async function provisionViaSignIn(
  page: Page,
  input: { uid: string; email: string; displayName: string },
): Promise<void> {
  await createEmulatorUser(input);
  const idToken = await emulatorIdToken(input.uid);
  const res = await page.request.post("/api/auth/session", { data: { idToken } });
  expect(res.ok(), `first sign-in provisioning failed (${res.status()})`).toBeTruthy();
}
