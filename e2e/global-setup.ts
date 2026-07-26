import { mkdirSync, writeFileSync } from "node:fs";
import { FieldValue } from "firebase-admin/firestore";
import { seed } from "../scripts/seed-dev-data";
import { SESSION_COOKIE_NAME } from "../src/lib/shared/constants";
import {
  DEACTIVATED_BOOTH_ID,
  OPERATOR_NAME,
  OPERATOR_UID,
  SAC_EXEC_STATE,
  SAC_EXEC_UID,
  SAC_MEMBER_STATE,
  SAC_MEMBER_UID,
} from "./fixtures";
import { db, mintSessionCookie } from "./helpers/firebase";

const OPERATOR_STATE = "e2e/.auth/operator.json";

async function writeStorageState(path: string, uid: string): Promise<void> {
  const cookie = await mintSessionCookie(uid);
  writeFileSync(
    path,
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

export default async function globalSetup(): Promise<void> {
  await seed();

  await db()
    .collection("booths")
    .doc(DEACTIVATED_BOOTH_ID)
    .collection("members")
    .doc(OPERATOR_UID)
    .set({ uid: OPERATOR_UID, displayName: OPERATOR_NAME, joinedAt: FieldValue.serverTimestamp() });

  mkdirSync("e2e/.auth", { recursive: true });
  await writeStorageState(OPERATOR_STATE, OPERATOR_UID);
  await writeStorageState(SAC_MEMBER_STATE, SAC_MEMBER_UID);
  await writeStorageState(SAC_EXEC_STATE, SAC_EXEC_UID);
}
