import "server-only";
import { z } from "zod";
import { usersCol } from "./db";
import { NotFoundError, SuspendedError } from "./errors";
import { buyerSchema, resolveBuyerUid } from "./money/shared";
import type { SacLookupResult } from "@/lib/shared/types";

export const sacLookupSchema = z.object({ buyer: buyerSchema }).strict();

export type SacLookupInput = z.infer<typeof sacLookupSchema>;

export async function sacLookupBuyer(input: SacLookupInput): Promise<SacLookupResult> {
  const buyerUid = await resolveBuyerUid(input.buyer);
  const buyer = (await usersCol().doc(buyerUid).get()).data();
  if (!buyer) throw new NotFoundError("No student found for that code or number.");
  if (buyer.suspended) throw new SuspendedError();

  return { name: buyer.displayName, balanceCents: buyer.balanceCents, points: buyer.points };
}
