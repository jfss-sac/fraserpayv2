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
      paymentCode: `fp1-${uid}`,
      balanceCents: input.balanceCents ?? 0,
      points: input.points ?? 0,
      roles: input.roles ?? { sacMember: false, sacExec: false },
      suspended: input.suspended ?? false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}
