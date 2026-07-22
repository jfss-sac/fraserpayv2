import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import type { DecodedIdToken } from "firebase-admin/auth";
import { ForbiddenError, InternalError, SuspendedError, UnauthorizedError } from "./errors";
import { boothsCol, ledgerCol } from "./db";
import { getAdminAuth, getAdminFirestore } from "./firebase-admin";
import { logger } from "./logger";
import { SESSION_COOKIE_NAME } from "@/lib/shared/constants";
import type {
  BoothItemSummary,
  BoothSummary,
  LedgerLineItem,
  MemberBooth,
} from "@/lib/shared/types";

export type Role = "public" | "session" | "active" | "sacMember" | "sacExec" | "boothMember";

export interface Session {
  uid: string;
  email: string;
  displayName: string;
  studentNumber: string | null;
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

export const getSession = cache(async (): Promise<Session | null> => {
  const cookieValue = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return resolveSessionFromCookie(cookieValue, false);
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  assertSession(session);
  return session;
}

export async function requireActive(): Promise<Session> {
  const session = await getSession();
  assertActive(session);
  return session;
}

export async function requireSacMember(): Promise<Session> {
  const session = await getSession();
  assertSacMember(session);
  return session;
}

export async function requireSacExec(): Promise<Session> {
  const session = await getSession();
  assertSacExec(session);
  return session;
}

export async function requireBoothMember(boothId: string): Promise<Session> {
  const session = await requireActive();
  if (!(await isBoothMember(boothId, session.uid))) {
    throw new ForbiddenError("You are not a member of this booth.");
  }
  return session;
}

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
      assertActive(session);
      if (!boothId) throw new InternalError();
      if (!(await isBoothMember(boothId, session.uid))) {
        throw new ForbiddenError("You are not a member of this booth.");
      }
      return session;
  }
}
