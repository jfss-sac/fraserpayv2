export type BoothStatus = "pending" | "approved" | "deactivated";

export type LedgerType = "topup" | "purchase" | "refund" | "adjustment";

export type LedgerDirection = "credit" | "debit";

export type PaymentMethod = "cash" | "card";

export interface SacRoles {
  sacMember: boolean;
  sacExec: boolean;
}

export type AuditAction =
  | "booth.approve"
  | "booth.priceEdit"
  | "booth.codeRotate"
  | "booth.memberRemove"
  | "booth.deactivate"
  | "booth.reactivate"
  | "user.suspend"
  | "user.unsuspend"
  | "user.roleGrant"
  | "user.roleRevoke"
  | "user.paymentCodeRegen";

export interface BoothItem {
  id: string;
  name: string;
  priceCents: number;
  isCustom: boolean;
}

export interface LedgerLineItem {
  itemId: string;
  name: string;
  qty: number;
  unitPriceCents: number;
}

export interface WalletHistoryEntry {
  id: string;
  type: LedgerType;
  direction: LedgerDirection;
  amountCents: number;
  balanceAfterCents: number;
  createdAt: string;
  tags: string[];
  boothName?: string;
  method?: PaymentMethod;
  lineItems?: LedgerLineItem[];
  reason?: string;
}

export interface WalletDTO {
  balanceCents: number;
  points: number;
  asOf: string;
  history: WalletHistoryEntry[];
}

export interface BoothDTO {
  id: string;
  name: string;
  description: string;
  status: BoothStatus;
  items: BoothItem[];
}

export interface MemberBooth {
  id: string;
  name: string;
  status: BoothStatus;
}

export interface BoothItemSummary {
  itemId: string;
  name: string;
  qty: number;
  revenueCents: number;
}

export interface BoothSummary {
  boothId: string;
  boothName: string;
  status: BoothStatus;
  grossCents: number;
  purchaseCount: number;
  refundCount: number;
  items: BoothItemSummary[];
}

export interface ChargeResult {
  entryId: string;
  amountCents: number;
}

export interface TopUpResult {
  entryId: string;
  amountCents: number;
  balanceAfterCents: number;
  points: number;
}

export interface AdjustResult {
  entryId: string;
  amountCents: number;
  balanceAfterCents: number;
  points: number;
}

export interface RefundResult {
  entryId: string;
  amountCents: number;
  balanceAfterCents: number;
}

export interface LookupResult {
  name: string;
  sufficient: boolean;
}
