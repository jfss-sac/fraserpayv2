import { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase";

export interface MakeUserInput {
  uid: string;
  studentNumber: string;
  displayName: string;
  balanceCents?: number;
  points?: number;
  suspended?: boolean;
  roles?: { sacMember: boolean; sacExec: boolean };
}

const CROCKFORD_ONLY = /[^0-9ABCDEFGHJKMNPQRSTVWXYZ]/g;

export function paymentCodeFor(uid: string): string {
  const body = uid.toUpperCase().replace(CROCKFORD_ONLY, "");
  return `fp1-${body.padEnd(26, "0").slice(0, 26)}`;
}

export async function paymentCodeOf(uid: string): Promise<string> {
  const snap = await db().collection("users").doc(uid).get();
  const code = snap.data()?.paymentCode as string | undefined;
  if (!code) throw new Error(`no payment code seeded for ${uid}`);
  return code;
}

export async function makeUser(input: MakeUserInput): Promise<void> {
  const { uid, studentNumber, displayName } = input;
  await db()
    .collection("users")
    .doc(uid)
    .set({
      email: `${studentNumber}@pdsb.net`,
      displayName,
      displayNameLower: displayName.toLowerCase(),
      studentNumber,
      paymentCode: paymentCodeFor(uid),
      balanceCents: input.balanceCents ?? 0,
      points: input.points ?? 0,
      roles: input.roles ?? { sacMember: false, sacExec: false },
      suspended: input.suspended ?? false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}
