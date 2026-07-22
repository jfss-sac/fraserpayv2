import { z } from "zod";
import { isValidAmount } from "./money";
import type { BoothItem } from "./types";

export const CUSTOM_ITEM_ID = "custom";

export const CUSTOM_ITEM: BoothItem = {
  id: CUSTOM_ITEM_ID,
  name: "Custom",
  priceCents: 50,
  isCustom: true,
};

export const boothItemInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    priceCents: z
      .number()
      .int()
      .refine(isValidAmount, "Item prices must be a positive multiple of $0.50."),
  })
  .strict();

export const boothRegistrationSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    items: z.array(boothItemInputSchema).min(1).max(50),
  })
  .strict();

export type BoothItemInput = z.infer<typeof boothItemInputSchema>;
export type BoothRegistrationInput = z.infer<typeof boothRegistrationSchema>;
