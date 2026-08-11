import "server-only";
import { FieldPath, type Query, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { type AuditLogDoc, type LedgerEntryDoc, auditCol, ledgerCol } from "./db";
import { REPEAT_BUYER_THRESHOLD, REPEAT_BUYER_WINDOW_MS } from "@/lib/shared/constants";
import type {
  FeedAuditEntry,
  FeedDTO,
  FeedLedgerEntry,
  RepeatBuyerAlert,
} from "@/lib/shared/types";

export const FEED_PAGE_SIZE = 25;

export const REPEAT_BUYER_SCAN_LIMIT = 500;

const HIGH_AMOUNT_TAG = "high-amount";

const FILTER_KEYS = ["type", "boothId", "actorUid", "tag"] as const;

export const feedQuerySchema = z
  .object({
    type: z.enum(["topup", "purchase", "refund", "adjustment"]).optional(),
    boothId: z.string().trim().min(1).optional(),
    actorUid: z.string().trim().min(1).optional(),
    tag: z.literal(HIGH_AMOUNT_TAG).optional(),
    cursor: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((v) => FILTER_KEYS.filter((k) => v[k] !== undefined).length <= 1, {
    message: "At most one feed filter may be applied at a time.",
  });

export type FeedQuery = z.infer<typeof feedQuerySchema>;

interface FeedCursor {
  ts: Timestamp;
  id: string;
}

function encodeCursor(ts: Timestamp, id: string): string {
  return Buffer.from(JSON.stringify({ s: ts.seconds, n: ts.nanoseconds, id })).toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): FeedCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString()) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const { s, n, id } = parsed as Record<string, unknown>;
    if (typeof s !== "number" || typeof n !== "number" || typeof id !== "string") return null;
    return { ts: new Timestamp(s, n), id };
  } catch {
    return null;
  }
}

interface Ranked {
  entry: FeedLedgerEntry | FeedAuditEntry;
  ts: Timestamp;
  id: string;
}

function rankDesc(a: Ranked, b: Ranked): number {
  if (a.ts.seconds !== b.ts.seconds) return b.ts.seconds - a.ts.seconds;
  if (a.ts.nanoseconds !== b.ts.nanoseconds) return b.ts.nanoseconds - a.ts.nanoseconds;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

function ordered<T>(query: Query<T>, cursor: FeedCursor | null): Query<T> {
  let q = query.orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc");
  if (cursor) q = q.startAfter(cursor.ts, cursor.id);
  return q.limit(FEED_PAGE_SIZE + 1);
}

function ledgerQuery(filters: FeedQuery, cursor: FeedCursor | null): Query<LedgerEntryDoc> {
  let q: Query<LedgerEntryDoc> = ledgerCol();
  if (filters.type) q = q.where("type", "==", filters.type);
  if (filters.boothId) q = q.where("boothId", "==", filters.boothId);
  if (filters.actorUid) q = q.where("actorUid", "==", filters.actorUid);
  if (filters.tag) q = q.where("tags", "array-contains", filters.tag);
  return ordered(q, cursor);
}

function auditQuery(filters: FeedQuery, cursor: FeedCursor | null): Query<AuditLogDoc> {
  let q: Query<AuditLogDoc> = auditCol();
  if (filters.actorUid) q = q.where("actorUid", "==", filters.actorUid);
  return ordered(q, cursor);
}

function auditParticipates(filters: FeedQuery): boolean {
  return filters.type === undefined && filters.boothId === undefined && filters.tag === undefined;
}

function toLedgerEntry(id: string, doc: LedgerEntryDoc): FeedLedgerEntry {
  return {
    kind: "ledger",
    id,
    createdAt: doc.createdAt.toDate().toISOString(),
    type: doc.type,
    direction: doc.direction,
    amountCents: doc.amountCents,
    balanceAfterCents: doc.balanceAfterCents,
    studentUid: doc.studentUid,
    studentNumber: doc.studentNumber,
    studentName: doc.studentName,
    actorUid: doc.actorUid,
    actorName: doc.actorName,
    tags: doc.tags,
    ...(doc.boothId !== undefined ? { boothId: doc.boothId } : {}),
    ...(doc.boothName !== undefined ? { boothName: doc.boothName } : {}),
    ...(doc.method !== undefined ? { method: doc.method } : {}),
    ...(doc.lineItems !== undefined ? { lineItems: doc.lineItems } : {}),
    ...(doc.reason !== undefined ? { reason: doc.reason } : {}),
    ...(doc.originalEntryId !== undefined ? { originalEntryId: doc.originalEntryId } : {}),
    ...(doc.pointsDelta !== undefined ? { pointsDelta: doc.pointsDelta } : {}),
  };
}

function toAuditEntry(id: string, doc: AuditLogDoc): FeedAuditEntry {
  return {
    kind: "audit",
    id,
    createdAt: doc.createdAt.toDate().toISOString(),
    action: doc.action,
    actorUid: doc.actorUid,
    actorName: doc.actorName,
    targetType: doc.targetType,
    targetId: doc.targetId,
    targetLabel: doc.targetLabel,
    details: doc.details as Record<string, unknown>,
  };
}

export function flagRepeatBuyers(
  purchases: { studentUid: string; studentName: string }[],
): RepeatBuyerAlert[] {
  const byBuyer = new Map<string, { studentName: string; charges: number }>();
  for (const purchase of purchases) {
    const seen = byBuyer.get(purchase.studentUid) ?? {
      studentName: purchase.studentName,
      charges: 0,
    };
    seen.charges += 1;
    byBuyer.set(purchase.studentUid, seen);
  }

  return [...byBuyer]
    .filter(([, buyer]) => buyer.charges >= REPEAT_BUYER_THRESHOLD)
    .map(([studentUid, buyer]) => ({ studentUid, ...buyer }))
    .sort((a, b) => b.charges - a.charges || a.studentName.localeCompare(b.studentName));
}

interface RepeatBuyerScan {
  buyers: RepeatBuyerAlert[];
  truncated: boolean;
}

async function repeatBuyersSince(nowMs: number): Promise<RepeatBuyerScan> {
  const snap = await ledgerCol()
    .where("type", "==", "purchase")
    .where("createdAt", ">=", Timestamp.fromMillis(nowMs - REPEAT_BUYER_WINDOW_MS))
    .orderBy("createdAt", "desc")
    .limit(REPEAT_BUYER_SCAN_LIMIT)
    .get();
  return {
    buyers: flagRepeatBuyers(snap.docs.map((doc) => doc.data())),
    truncated: snap.size === REPEAT_BUYER_SCAN_LIMIT,
  };
}

export async function getFeed(input: FeedQuery, nowMs: number = Date.now()): Promise<FeedDTO> {
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;

  const [snaps, repeatBuyers] = await Promise.all([
    Promise.all([
      ledgerQuery(input, cursor).get(),
      auditParticipates(input) ? auditQuery(input, cursor).get() : null,
    ]),
    cursor
      ? Promise.resolve<RepeatBuyerScan>({ buyers: [], truncated: false })
      : repeatBuyersSince(nowMs),
  ]);

  const ranked: Ranked[] = [];
  for (const d of snaps[0].docs) {
    const doc = d.data();
    ranked.push({ entry: toLedgerEntry(d.id, doc), ts: doc.createdAt, id: d.id });
  }
  if (snaps[1]) {
    for (const d of snaps[1].docs) {
      const doc = d.data();
      ranked.push({ entry: toAuditEntry(d.id, doc), ts: doc.createdAt, id: d.id });
    }
  }

  ranked.sort(rankDesc);
  const hasMore = ranked.length > FEED_PAGE_SIZE;
  const page = hasMore ? ranked.slice(0, FEED_PAGE_SIZE) : ranked;
  const last = page[page.length - 1];

  return {
    entries: page.map((r) => r.entry),
    nextCursor: hasMore && last ? encodeCursor(last.ts, last.id) : null,
    repeatBuyers: repeatBuyers.buyers,
    repeatBuyersTruncated: repeatBuyers.truncated,
  };
}
