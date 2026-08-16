import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { AggregateField, type Transaction } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { z } from "zod";
import {
  BoothNotSellableError,
  ForbiddenError,
  InternalError,
  SuspendedError,
  UnauthorizedError,
  ValidationError,
} from "./errors";
import { type LedgerEntryDoc, type UserDoc, boothsCol, ledgerCol, usersCol } from "./db";
import { getAdminAuth, getAdminFirestore } from "./firebase-admin";
import { logger } from "./logger";
import { SESSION_COOKIE_NAME } from "@/lib/shared/constants";
import type {
  BoothDTO,
  BoothHistoryDTO,
  BoothHistoryEntry,
  BoothItemSummary,
  BoothStatus,
  BoothSummary,
  LedgerLineItem,
  MemberBooth,
} from "@/lib/shared/types";

export type Role =
  "public" | "session" | "active" | "sacMember" | "sacExec" | "boothMember" | "boothOperator";
export type BoothScopedRole = Extract<Role, "boothMember" | "boothOperator">;
export type TransactionRole = "active" | "sacMember" | "sacExec";

export interface TransactionAuthorization {
  actorUid: string;
  role: TransactionRole;
}

export interface AuthorizedActor {
  uid: string;
  displayName: string;
}

export function isBoothScopedRole(role: Role): role is BoothScopedRole {
  return role === "boothMember" || role === "boothOperator";
}

export function transactionRoleFor(role: Role): TransactionRole | undefined {
  if (role === "boothOperator") return "active";
  return role === "active" || role === "sacMember" || role === "sacExec" ? role : undefined;
}

export interface BoothLedgerTotals {
  grossCents: number;
  purchaseCount: number;
  refundCount: number;
}

export interface Session {
  uid: string;
  email: string;
  displayName: string;
  studentNumber: string | null;
  paymentCode: string;
  balanceCents: number;
  points: number;
  roles: { sacMember: boolean; sacExec: boolean };
  suspended: boolean;
}

function cookieFromHeader(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function toSession(decoded: DecodedIdToken, data: FirebaseFirestore.DocumentData): Session {
  const roles = (data.roles ?? {}) as { sacMember?: boolean; sacExec?: boolean };
  return {
    uid: decoded.uid,
    email: (data.email as string | undefined) ?? decoded.email ?? "",
    displayName: (data.displayName as string | undefined) ?? "",
    studentNumber: (data.studentNumber as string | null | undefined) ?? null,
    paymentCode: (data.paymentCode as string | undefined) ?? "",
    balanceCents: (data.balanceCents as number | undefined) ?? 0,
    points: (data.points as number | undefined) ?? 0,
    roles: { sacMember: roles.sacMember === true, sacExec: roles.sacExec === true },
    suspended: data.suspended === true,
  };
}

const resolveSessionFromCookie = cache(
  async (cookieValue: string | undefined, checkRevoked: boolean): Promise<Session | null> => {
    if (!cookieValue) return null;
    let decoded: DecodedIdToken;
    try {
      decoded = await getAdminAuth().verifySessionCookie(cookieValue, checkRevoked);
    } catch {
      return null;
    }
    const snap = await getAdminFirestore().collection("users").doc(decoded.uid).get();
    const data = snap.data();
    if (!data) return null;
    return toSession(decoded, data);
  },
);

export const isBoothMember = cache(async (boothId: string, uid: string): Promise<boolean> => {
  const snap = await getAdminFirestore()
    .collection("booths")
    .doc(boothId)
    .collection("members")
    .doc(uid)
    .get();
  return snap.exists;
});

const getBoothStatus = cache(async (boothId: string): Promise<BoothStatus | null> => {
  const data = (await boothsCol().doc(boothId).get()).data();
  return data ? data.status : null;
});

export function isBoothOperatorActor(isMember: boolean, roles: { sacExec: boolean }): boolean {
  return isMember || roles.sacExec;
}

export async function isBoothOperator(boothId: string, session: Session): Promise<boolean> {
  const isMember = await isBoothMember(boothId, session.uid);
  if (!isBoothOperatorActor(isMember, session.roles)) return false;
  return isMember || (await getBoothStatus(boothId)) === "approved";
}

export const hasAnyBoothMembership = cache(async (uid: string): Promise<boolean> => {
  try {
    const snap = await getAdminFirestore()
      .collectionGroup("members")
      .where("uid", "==", uid)
      .limit(1)
      .get();
    return !snap.empty;
  } catch (err) {
    logger.warn({ event: "booth-membership-check-failed", actorUid: uid, err });
    return false;
  }
});

export const listMemberBooths = cache(async (uid: string): Promise<MemberBooth[]> => {
  const db = getAdminFirestore();
  const memberships = await db.collectionGroup("members").where("uid", "==", uid).get();
  const ids = [
    ...new Set(
      memberships.docs
        .map((doc) => doc.ref.parent.parent?.id)
        .filter((id): id is string => id !== undefined),
    ),
  ];
  if (ids.length === 0) return [];
  const snaps = await db.getAll(...ids.map((id) => boothsCol().doc(id)));
  return snaps
    .flatMap((snap) => {
      const data = snap.data();
      return data ? [{ id: snap.id, name: data.name, status: data.status }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
});

export const getBoothCatalog = cache(async (boothId: string): Promise<BoothDTO | null> => {
  const data = (await boothsCol().doc(boothId).get()).data();
  if (!data) return null;
  return {
    id: boothId,
    name: data.name,
    description: data.description,
    status: data.status,
    items: data.items
      .filter((item) => item.archived !== true)
      .map(({ id, name, priceCents, isCustom }) => ({ id, name, priceCents, isCustom })),
  };
});

async function aggregateByType(
  type: LedgerEntryDoc["type"],
  boothId: string,
): Promise<{ cents: number; count: number }> {
  const snap = await ledgerCol()
    .where("type", "==", type)
    .where("boothId", "==", boothId)
    .aggregate({ cents: AggregateField.sum("amountCents"), count: AggregateField.count() })
    .get();
  return { cents: snap.data().cents, count: snap.data().count };
}

export async function getBoothLedgerTotals(boothId: string): Promise<BoothLedgerTotals> {
  const [purchases, refunds] = await Promise.all([
    aggregateByType("purchase", boothId),
    aggregateByType("refund", boothId),
  ]);
  return {
    grossCents: purchases.cents - refunds.cents,
    purchaseCount: purchases.count,
    refundCount: refunds.count,
  };
}

export async function getBoothGrossCents(boothId: string): Promise<number> {
  return (await getBoothLedgerTotals(boothId)).grossCents;
}

export async function getBoothSummary(boothId: string): Promise<BoothSummary | null> {
  const booth = (await boothsCol().doc(boothId).get()).data();
  if (!booth) return null;

  const [purchases, refunds] = await Promise.all([
    ledgerCol().where("type", "==", "purchase").where("boothId", "==", boothId).get(),
    ledgerCol().where("type", "==", "refund").where("boothId", "==", boothId).get(),
  ]);

  const itemOrder = new Map(booth.items.map((item, index) => [item.id, index]));
  const byItem = new Map<string, BoothItemSummary>();
  const accumulate = (line: LedgerLineItem, sign: 1 | -1): void => {
    const current = byItem.get(line.itemId) ?? {
      itemId: line.itemId,
      name: line.name,
      qty: 0,
      revenueCents: 0,
    };
    current.qty += sign * line.qty;
    current.revenueCents += sign * line.qty * line.unitPriceCents;
    byItem.set(line.itemId, current);
  };

  let grossCents = 0;
  for (const doc of purchases.docs) {
    const entry = doc.data();
    grossCents += entry.amountCents;
    for (const line of entry.lineItems ?? []) accumulate(line, 1);
  }
  for (const doc of refunds.docs) {
    const entry = doc.data();
    grossCents -= entry.amountCents;
    for (const line of entry.lineItems ?? []) accumulate(line, -1);
  }

  const items = [...byItem.values()].sort((a, b) => {
    const ai = itemOrder.get(a.itemId) ?? Number.MAX_SAFE_INTEGER;
    const bi = itemOrder.get(b.itemId) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi || a.name.localeCompare(b.name);
  });

  return {
    boothId,
    boothName: booth.name,
    status: booth.status,
    grossCents,
    purchaseCount: purchases.size,
    refundCount: refunds.size,
    items,
  };
}

export const BOOTH_HISTORY_PAGE_SIZE = 25;

export const boothHistoryQuerySchema = z
  .object({ cursor: z.string().trim().min(1).optional(), mine: z.literal("1").optional() })
  .strict();

export type BoothHistoryQuery = z.infer<typeof boothHistoryQuerySchema>;

const LEDGER_ENTRY_ID = /^[A-Za-z0-9_-]{1,128}$/;

function toBoothHistoryEntry(entryId: string, doc: LedgerEntryDoc): BoothHistoryEntry {
  return {
    entryId,
    createdAt: doc.createdAt.toDate().toISOString(),
    type: doc.type,
    amountCents: doc.amountCents,
    direction: doc.direction,
    buyerName: doc.studentName,
    lineItems: doc.lineItems ?? [],
    actorName: doc.actorName,
    ...(doc.originalEntryId !== undefined ? { originalEntryId: doc.originalEntryId } : {}),
  };
}

export async function getBoothHistory(
  boothId: string,
  options: { cursor?: string; actorUid?: string } = {},
): Promise<BoothHistoryDTO> {
  const scoped = options.actorUid
    ? ledgerCol().where("boothId", "==", boothId).where("actorUid", "==", options.actorUid)
    : ledgerCol().where("boothId", "==", boothId);

  let query = scoped.orderBy("createdAt", "desc").limit(BOOTH_HISTORY_PAGE_SIZE + 1);
  if (options.cursor) {
    const unknownCursor = new ValidationError("cursor: Unknown cursor.");
    if (!LEDGER_ENTRY_ID.test(options.cursor)) throw unknownCursor;
    const cursorSnap = await ledgerCol().doc(options.cursor).get();
    const cursorDoc = cursorSnap.data();
    if (!cursorDoc || cursorDoc.boothId !== boothId) throw unknownCursor;
    if (options.actorUid && cursorDoc.actorUid !== options.actorUid) throw unknownCursor;
    query = query.startAfter(cursorSnap);
  }

  const docs = (await query.get()).docs;
  const hasMore = docs.length > BOOTH_HISTORY_PAGE_SIZE;
  const page = hasMore ? docs.slice(0, BOOTH_HISTORY_PAGE_SIZE) : docs;

  return {
    entries: page.map((d) => toBoothHistoryEntry(d.id, d.data())),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

function assertSession(session: Session | null): asserts session is Session {
  if (!session) throw new UnauthorizedError();
}

function assertActive(session: Session | null): asserts session is Session {
  assertSession(session);
  if (session.suspended) throw new SuspendedError();
}

function assertSacMember(session: Session | null): asserts session is Session {
  assertActive(session);
  if (!session.roles.sacMember && !session.roles.sacExec) throw new ForbiddenError();
}

function assertSacExec(session: Session | null): asserts session is Session {
  assertActive(session);
  if (!session.roles.sacExec) throw new ForbiddenError();
}

export function assertActorAuthorized(actor: UserDoc | undefined, role: TransactionRole): UserDoc {
  if (!actor) throw new UnauthorizedError();
  if (actor.suspended) throw new SuspendedError();

  switch (role) {
    case "active":
      break;
    case "sacMember":
      if (!actor.roles.sacMember && !actor.roles.sacExec) throw new ForbiddenError();
      break;
    case "sacExec":
      if (!actor.roles.sacExec) throw new ForbiddenError();
      break;
  }

  return actor;
}

export async function assertBoothScope(
  role: BoothScopedRole,
  session: Session,
  boothId: string,
): Promise<void> {
  const notAMember = new ForbiddenError("You are not a member of this booth.");
  if (role === "boothMember") {
    if (!(await isBoothMember(boothId, session.uid))) throw notAMember;
    return;
  }
  if (await isBoothOperator(boothId, session)) return;
  if (!session.roles.sacExec) throw notAMember;
  throw new BoothNotSellableError();
}

export async function runAuthorizedTransaction<T>(
  authorization: TransactionAuthorization | undefined,
  updateFunction: (transaction: Transaction, actor: AuthorizedActor) => Promise<T>,
): Promise<T> {
  if (!authorization) throw new InternalError();
  return getAdminFirestore().runTransaction(async (transaction) => {
    const doc = assertActorAuthorized(
      (await transaction.get(usersCol().doc(authorization.actorUid))).data(),
      authorization.role,
    );
    return updateFunction(transaction, {
      uid: authorization.actorUid,
      displayName: doc.displayName,
    });
  });
}

export const getSession = cache(async (): Promise<Session | null> => {
  const cookieValue = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return resolveSessionFromCookie(cookieValue, false);
});

function isMutation(method: string): boolean {
  const m = method.toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}

export async function authorizeRequest(
  role: Role,
  request: Request,
  boothId?: string,
): Promise<Session | null> {
  if (role === "public") return null;

  const cookieValue = cookieFromHeader(request.headers.get("cookie"));
  const session = await resolveSessionFromCookie(cookieValue, isMutation(request.method));

  switch (role) {
    case "session":
      assertSession(session);
      return session;
    case "active":
      assertActive(session);
      return session;
    case "sacMember":
      assertSacMember(session);
      return session;
    case "sacExec":
      assertSacExec(session);
      return session;
    case "boothMember":
    case "boothOperator":
      assertActive(session);
      if (!boothId) throw new InternalError();
      await assertBoothScope(role, session, boothId);
      return session;
  }
}
