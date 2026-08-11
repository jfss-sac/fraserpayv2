import "server-only";
import { z } from "zod";
import { SuspendedError } from "./errors";
import { buyerSchema, resolveBuyer } from "./money/shared";
import type { SacLookupResult } from "@/lib/shared/types";

export const sacLookupSchema = z.object({ buyer: buyerSchema }).strict();

export type SacLookupInput = z.infer<typeof sacLookupSchema>;

export async function sacLookupBuyer(input: SacLookupInput): Promise<SacLookupResult> {
  const { data: buyer } = await resolveBuyer(input.buyer);
  if (buyer.suspended) throw new SuspendedError();

  return { name: buyer.displayName, balanceCents: buyer.balanceCents, points: buyer.points };
}
