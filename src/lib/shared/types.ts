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
  | "booth.itemAdd"
  | "booth.itemArchive"
  | "booth.itemUnarchive"
  | "booth.codeRotate"
  | "booth.memberRemove"
  | "booth.deactivate"
  | "booth.reactivate"
  | "booth.execCharge"
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
  archived?: boolean;
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

export interface AdminBoothListItem {
  id: string;
  name: string;
  status: BoothStatus;
  submitterEmail: string;
  joinCode: string | null;
}

export interface BoothMemberDTO {
  uid: string;
  displayName: string;
  joinedAt: string;
}

export interface BoothItemSummary {
  itemId: string;
  name: string;
  qty: number;
  revenueCents: number;
}

export interface BoothReportRow {
  boothId: string;
  boothName: string;
  status: BoothStatus;
  grossCents: number;
  purchaseCount: number;
  refundCount: number;
}

export interface BoothSummary extends BoothReportRow {
  items: BoothItemSummary[];
}

export interface BoothDetail {
  id: string;
  name: string;
  description: string;
  status: BoothStatus;
  items: BoothItem[];
  joinCode: string | null;
  submitterUid: string;
  submitterEmail: string;
  createdAt: string;
  approvedAt: string | null;
  members: BoothMemberDTO[];
  summary: BoothSummary | null;
}

export interface BoothHistoryEntry {
  entryId: string;
  createdAt: string;
  type: LedgerType;
  amountCents: number;
  direction: LedgerDirection;
  buyerName: string;
  lineItems: LedgerLineItem[];
  actorName: string;
  originalEntryId?: string;
}

export interface BoothHistoryDTO {
  entries: BoothHistoryEntry[];
  nextCursor: string | null;
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

export interface RecentPurchase {
  amountCents: number;
  ageMs: number;
}

export interface LookupResult {
  name: string;
  balanceCents: number;
  lastPurchase: RecentPurchase | null;
}

export interface SacLookupResult {
  name: string;
  balanceCents: number;
  points: number;
}

export interface StudentSearchResult {
  uid: string;
  displayName: string;
  studentNumber: string | null;
  email: string;
  balanceCents: number;
  points: number;
  suspended: boolean;
}

export interface StudentSearchDTO {
  results: StudentSearchResult[];
}

export interface StudentDetail {
  uid: string;
  displayName: string;
  studentNumber: string | null;
  email: string;
  balanceCents: number;
  points: number;
  suspended: boolean;
  hasPaymentCode: boolean;
  roles: SacRoles;
}

export interface SacLedgerEntry {
  id: string;
  type: LedgerType;
  direction: LedgerDirection;
  amountCents: number;
  balanceAfterCents: number;
  createdAt: string;
  tags: string[];
  actorName: string;
  boothName?: string;
  method?: PaymentMethod;
  lineItems?: LedgerLineItem[];
  reason?: string;
  originalEntryId?: string;
  pointsDelta?: number;
}

export interface StudentLedgerDTO {
  entries: SacLedgerEntry[];
  nextCursor: string | null;
}

export interface FeedLedgerEntry {
  kind: "ledger";
  id: string;
  createdAt: string;
  type: LedgerType;
  direction: LedgerDirection;
  amountCents: number;
  balanceAfterCents: number;
  studentUid: string;
  studentNumber: string | null;
  studentName: string;
  actorUid: string;
  actorName: string;
  tags: string[];
  boothId?: string;
  boothName?: string;
  method?: PaymentMethod;
  lineItems?: LedgerLineItem[];
  reason?: string;
  originalEntryId?: string;
  pointsDelta?: number;
}

export interface FeedAuditEntry {
  kind: "audit";
  id: string;
  createdAt: string;
  action: AuditAction;
  actorUid: string;
  actorName: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  details: Record<string, unknown>;
}

export type FeedEntry = FeedLedgerEntry | FeedAuditEntry;

export interface RepeatBuyerAlert {
  studentUid: string;
  studentName: string;
  charges: number;
}

export interface FeedDTO {
  entries: FeedEntry[];
  nextCursor: string | null;
  repeatBuyers: RepeatBuyerAlert[];
  repeatBuyersTruncated: boolean;
}

export interface ReconTopupEntry {
  id: string;
  createdAt: string;
  amountCents: number;
  method: PaymentMethod;
  studentName: string;
  studentNumber: string | null;
  tags: string[];
}

export interface ReconCorrectionEntry {
  id: string;
  createdAt: string;
  amountCents: number;
  direction: LedgerDirection;
  studentName: string;
  studentNumber: string | null;
  reason: string | null;
  originalEntryId: string;
  pointsDelta: number | null;
}

export interface ReconMemberTotals {
  actorUid: string;
  actorName: string;
  cashCents: number;
  cashCount: number;
  cardCents: number;
  cardCount: number;
  topups: ReconTopupEntry[];
  corrections: ReconCorrectionEntry[];
}

export interface ReconciliationTotals {
  cashCents: number;
  cardCents: number;
  topupCount: number;
  correctionCount: number;
}

export interface ReconciliationDTO {
  date: string;
  members: ReconMemberTotals[];
  totals: ReconciliationTotals;
}

export interface ReportTopupTotals {
  cashCents: number;
  cardCents: number;
  totalCents: number;
  count: number;
}

export interface ReportsDTO {
  booths: BoothReportRow[];
  grossTotalCents: number;
  topups: ReportTopupTotals;
  outstandingLiabilityCents: number;
}

export interface LeaderboardRow {
  rank: number;
  boothId: string;
  boothName: string;
  grossCents: number;
}

export interface LeaderboardDTO {
  rows: LeaderboardRow[];
}

export interface ActivityScopeUsage {
  scope: string;
  peakRequests: number;
  limit: number;
  windowMs: number;
  blockedWindows: number;
}

export interface ActivityActor {
  uid: string;
  displayName: string;
  suspended: boolean;
  totalRequests: number;
  peakRequests: number;
  blockedWindows: number;
  lastSeenIso: string;
  scopes: ActivityScopeUsage[];
}

export interface ActivityDTO {
  actors: ActivityActor[];
  notableThreshold: number;
  lookbackMs: number;
  truncated: boolean;
}
