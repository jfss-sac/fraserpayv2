import { mkdirSync, writeFileSync } from "node:fs";
import { FieldValue } from "firebase-admin/firestore";
import { seed } from "../scripts/seed-dev-data";
import { SESSION_COOKIE_NAME } from "../src/lib/shared/constants";
import { DEACTIVATED_BOOTH_ID, OPERATOR_NAME, OPERATOR_UID } from "./fixtures";
import { db, mintSessionCookie } from "./helpers/firebase";

const STORAGE_STATE_PATH = "e2e/.auth/operator.json";

export default async function globalSetup(): Promise<void> {
  await seed();

  await db()
    .collection("booths")
    .doc(DEACTIVATED_BOOTH_ID)
    .collection("members")
    .doc(OPERATOR_UID)
    .set({ uid: OPERATOR_UID, displayName: OPERATOR_NAME, joinedAt: FieldValue.serverTimestamp() });

  const cookie = await mintSessionCookie(OPERATOR_UID);

  mkdirSync("e2e/.auth", { recursive: true });
  writeFileSync(
    STORAGE_STATE_PATH,
    JSON.stringify({
      cookies: [
        {
          name: SESSION_COOKIE_NAME,
          value: cookie,
          domain: "127.0.0.1",
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
  );
}
