import "server-only";
import { type DocumentReference, type Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { type UserDoc, usersCol } from "../db";
import { NotFoundError, SuspendedError } from "../errors";
import { requireUser } from "./invariants";
import { BOOTH_STUDENT_NUMBER_ENABLED, TIMEZONE } from "@/lib/shared/constants";

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

export const boothBuyerSchema = buyerSchema.refine(
  (buyer) => BOOTH_STUDENT_NUMBER_ENABLED || "paymentCode" in buyer,
  { message: "Scan the buyer's QR code — student numbers are not accepted here." },
);

export interface ResolvedBuyer {
  uid: string;
  data: UserDoc;
}

const BUYER_NOT_FOUND = "No student found for that code or number.";

export async function resolveBuyer(buyer: BuyerRef): Promise<ResolvedBuyer> {
  const query =
    "paymentCode" in buyer
      ? usersCol().where("paymentCode", "==", buyer.paymentCode)
      : usersCol().where("studentNumber", "==", buyer.studentNumber);
  const doc = (await query.limit(1).get()).docs[0];
  if (!doc) throw new NotFoundError(BUYER_NOT_FOUND);
  return { uid: doc.id, data: doc.data() };
}

export interface ActiveBuyer {
  uid: string;
  ref: DocumentReference<UserDoc>;
  data: UserDoc;
}

function stillIdentifies(buyer: BuyerRef, data: UserDoc): boolean {
  return "paymentCode" in buyer
    ? data.paymentCode === buyer.paymentCode
    : data.studentNumber === buyer.studentNumber;
}

export async function resolveActiveBuyer(t: Transaction, buyer: BuyerRef): Promise<ActiveBuyer> {
  const { uid } = await resolveBuyer(buyer);
  const ref = usersCol().doc(uid);
  const data = requireUser((await t.get(ref)).data(), BUYER_NOT_FOUND);
  if (!stillIdentifies(buyer, data)) throw new NotFoundError(BUYER_NOT_FOUND);
  if (data.suspended) throw new SuspendedError();
  return { uid, ref, data };
}

export async function readUser(t: Transaction, uid: string): Promise<ActiveBuyer> {
  const ref = usersCol().doc(uid);
  const data = requireUser((await t.get(ref)).data(), "Student not found.");
  return { uid, ref, data };
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
