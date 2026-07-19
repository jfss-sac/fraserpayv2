import {
  BALANCE_CAP_CENTS,
  CENT_STEP,
  HIGH_AMOUNT_CENTS,
  POINTS_PER_DOLLAR,
  RECONFIRM_CENTS,
  TOPUP_CAP_CENTS,
} from "./constants";

export function isValidAmount(cents: number): boolean {
  return Number.isInteger(cents) && cents > 0 && cents % CENT_STEP === 0;
}

export function pointsFor(amountCents: number): number {
  return (amountCents * POINTS_PER_DOLLAR) / 100;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = (abs % 100).toString().padStart(2, "0");
  return `${sign}$${dollars}.${remainder}`;
}

export function exceedsTopupCap(amountCents: number): boolean {
  return amountCents > TOPUP_CAP_CENTS;
}

export function exceedsBalanceCap(resultingBalanceCents: number): boolean {
  return resultingBalanceCents > BALANCE_CAP_CENTS;
}

export function requiresReconfirm(amountCents: number): boolean {
  return amountCents > RECONFIRM_CENTS;
}

export function isHighAmount(amountCents: number): boolean {
  return amountCents > HIGH_AMOUNT_CENTS;
}
