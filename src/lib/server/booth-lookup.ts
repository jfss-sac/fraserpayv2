import "server-only";
import { z } from "zod";
import { isBoothMember } from "./dal";
import { usersCol } from "./db";
import { ForbiddenError, NotFoundError, SuspendedError } from "./errors";
import { buyerSchema, resolveBuyerUid } from "./money/shared";
import type { LookupResult } from "@/lib/shared/types";

export const lookupSchema = z
  .object({
    boothId: z.string().trim().min(1),
    buyer: buyerSchema,
    cartTotalCents: z.number().int().nonnegative(),
  })
  .strict();

export type LookupInput = z.infer<typeof lookupSchema>;

export async function lookupBuyer(args: {
  input: LookupInput;
  actorUid: string;
}): Promise<LookupResult> {
  const { input, actorUid } = args;

  if (!(await isBoothMember(input.boothId, actorUid))) {
    throw new ForbiddenError("You are not a member of this booth.");
  }

  const buyerUid = await resolveBuyerUid(input.buyer);
  const buyer = (await usersCol().doc(buyerUid).get()).data();
  if (!buyer) throw new NotFoundError("No student found for that code or number.");
  if (buyer.suspended) throw new SuspendedError();

  return { name: buyer.displayName, sufficient: buyer.balanceCents >= input.cartTotalCents };
}
