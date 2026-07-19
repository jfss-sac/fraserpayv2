import "server-only";
import { InternalError } from "@/lib/server/errors";
import { getAdminAuth } from "@/lib/server/firebase-admin";
import { defineHandler } from "@/lib/server/http";
import { SESSION_COOKIE_NAME } from "@/lib/shared/constants";

function clearedSessionCookie(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
  ].join("; ");
}

export const POST = defineHandler({ role: "session" }, async ({ session }) => {
  try {
    await getAdminAuth().revokeRefreshTokens(session!.uid);
  } catch {
    throw new InternalError();
  }

  const response = Response.json({ ok: true });
  response.headers.append("set-cookie", clearedSessionCookie());
  response.headers.set("clear-site-data", '"cache", "storage"');
  return response;
});
