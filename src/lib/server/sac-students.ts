import "server-only";
import { z } from "zod";
import { type LedgerEntryDoc, type UserDoc, ledgerCol, usersCol } from "./db";
import { ValidationError } from "./errors";
import { firestoreDocumentIdSchema, isFirestoreDocumentId } from "@/lib/shared/document-id";
import type {
  SacLedgerEntry,
  StudentDetail,
  StudentLedgerDTO,
  StudentSearchResult,
} from "@/lib/shared/types";

export const SEARCH_LIMIT = 20;
export const LEDGER_PAGE_SIZE = 25;

const PREFIX_HIGH = String.fromCharCode(0xf8ff);

export const studentSearchSchema = z.object({ q: z.string().trim().min(1) }).strict();

export const studentLedgerQuerySchema = z
  .object({ cursor: firestoreDocumentIdSchema.optional() })
  .strict();

export type SearchMode = "email" | "studentNumber" | "name";

export function searchMode(q: string): SearchMode {
  if (q.includes("@")) return "email";
  if (/^[0-9]+$/.test(q)) return "studentNumber";
  return "name";
}

function toSearchResult(uid: string, doc: UserDoc): StudentSearchResult {
  return {
    uid,
    displayName: doc.displayName,
    studentNumber: doc.studentNumber,
    email: doc.email,
    balanceCents: doc.balanceCents,
    points: doc.points,
    suspended: doc.suspended,
  };
}

export async function searchStudents(q: string): Promise<StudentSearchResult[]> {
  const trimmed = q.trim();
  const col = usersCol();

  const query = (() => {
    switch (searchMode(trimmed)) {
      case "email":
        return col.where("email", "==", trimmed.toLowerCase()).limit(SEARCH_LIMIT);
      case "studentNumber":
        return col.where("studentNumber", "==", trimmed).limit(SEARCH_LIMIT);
      case "name": {
        const lower = trimmed.toLowerCase();
        return col
          .orderBy("displayNameLower")
          .startAt(lower)
          .endAt(lower + PREFIX_HIGH)
          .limit(SEARCH_LIMIT);
      }
    }
  })();

  const snap = await query.get();
  return snap.docs.map((d) => toSearchResult(d.id, d.data()));
}

export async function getStudentDetail(uid: string): Promise<StudentDetail | null> {
  const doc = (await usersCol().doc(uid).get()).data();
  if (!doc) return null;
  return {
    uid,
    displayName: doc.displayName,
    studentNumber: doc.studentNumber,
    email: doc.email,
    balanceCents: doc.balanceCents,
    points: doc.points,
    suspended: doc.suspended,
    hasPaymentCode: typeof doc.paymentCode === "string" && doc.paymentCode.length > 0,
    roles: { sacMember: doc.roles.sacMember === true, sacExec: doc.roles.sacExec === true },
  };
}

function toLedgerEntry(id: string, doc: LedgerEntryDoc): SacLedgerEntry {
  return {
    id,
    type: doc.type,
    direction: doc.direction,
    amountCents: doc.amountCents,
    balanceAfterCents: doc.balanceAfterCents,
    createdAt: doc.createdAt.toDate().toISOString(),
    tags: doc.tags,
    actorName: doc.actorName,
    ...(doc.boothName !== undefined ? { boothName: doc.boothName } : {}),
    ...(doc.method !== undefined ? { method: doc.method } : {}),
    ...(doc.lineItems !== undefined ? { lineItems: doc.lineItems } : {}),
    ...(doc.reason !== undefined ? { reason: doc.reason } : {}),
    ...(doc.originalEntryId !== undefined ? { originalEntryId: doc.originalEntryId } : {}),
    ...(doc.pointsDelta !== undefined ? { pointsDelta: doc.pointsDelta } : {}),
  };
}

export async function getStudentLedger(uid: string, cursor?: string): Promise<StudentLedgerDTO> {
  let query = ledgerCol()
    .where("studentUid", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(LEDGER_PAGE_SIZE + 1);

  if (cursor) {
    const unknownCursor = new ValidationError("cursor: Unknown cursor.");
    if (!isFirestoreDocumentId(cursor)) throw unknownCursor;
    const cursorSnap = await ledgerCol().doc(cursor).get();
    const cursorDoc = cursorSnap.data();
    if (!cursorDoc || cursorDoc.studentUid !== uid) throw unknownCursor;
    query = query.startAfter(cursorSnap);
  }

  const docs = (await query.get()).docs;
  const hasMore = docs.length > LEDGER_PAGE_SIZE;
  const page = hasMore ? docs.slice(0, LEDGER_PAGE_SIZE) : docs;

  return {
    entries: page.map((d) => toLedgerEntry(d.id, d.data())),
    nextCursor: hasMore ? (page[page.length - 1]!.id ?? null) : null,
  };
}
