import "server-only";
import { getAdminAuth } from "@/lib/server/firebase-admin";
import { defineHandler } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
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

export const POST = defineHandler({ role: "session" }, async ({ session, requestId }) => {
  let revoked = true;
  try {
    await getAdminAuth().revokeRefreshTokens(session!.uid);
  } catch (err) {
    revoked = false;
    logger.error({
      event: "signout-revoke-failed",
      requestId,
      route: "/api/auth/signout",
      actorUid: session!.uid,
      err,
    });
  }

  const response = Response.json({ ok: true, revoked });
  response.headers.append("set-cookie", clearedSessionCookie());
  response.headers.set("clear-site-data", '"cache", "storage"');
  return response;
});
