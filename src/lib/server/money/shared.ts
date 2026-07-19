import "server-only";
import { type DocumentReference, type Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { type UserDoc, usersCol } from "../db";
import { NotFoundError, SuspendedError } from "../errors";
import { TIMEZONE } from "@/lib/shared/constants";

export const buyerSchema = z
  .union([
    z.object({ paymentCode: z.string().trim().min(1) }).strict(),
    z
      .object({
        studentNumber: z
          .string()
          .trim()
          .regex(/^[0-9]+$/),
      })
      .strict(),
  ])
  .describe("buyer");

export type BuyerRef = z.infer<typeof buyerSchema>;

export async function resolveBuyerUid(buyer: BuyerRef): Promise<string> {
  const query =
    "paymentCode" in buyer
      ? usersCol().where("paymentCode", "==", buyer.paymentCode)
      : usersCol().where("studentNumber", "==", buyer.studentNumber);
  const doc = (await query.limit(1).get()).docs[0];
  if (!doc) throw new NotFoundError("No student found for that code or number.");
  return doc.id;
}

export interface ActiveBuyer {
  ref: DocumentReference<UserDoc>;
  data: UserDoc;
}

export async function readActiveBuyer(t: Transaction, uid: string): Promise<ActiveBuyer> {
  const ref = usersCol().doc(uid);
  const data = (await t.get(ref)).data();
  if (!data) throw new NotFoundError("No student found for that code or number.");
  if (data.suspended) throw new SuspendedError();
  return { ref, data };
}

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function torontoDate(at: Date): string {
  return dateFormatter.format(at);
}
