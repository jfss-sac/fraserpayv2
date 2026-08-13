import "server-only";
import { createHash } from "node:crypto";
import {
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction,
  Timestamp,
} from "firebase-admin/firestore";
import { type IdempotencyDoc, type UserDoc, idempotencyCol, usersCol } from "./db";
import { assertActorAuthorized, type TransactionRole } from "./dal";
import { IdempotencyConflictError, ValidationError } from "./errors";
import { getAdminFirestore } from "./firebase-admin";
import { UUID_V4_RE } from "@/lib/shared/uuid";

export const IDEMPOTENCY_HEADER = "idempotency-key";

export const IDEMPOTENT_REPLAY_HEADER = "idempotent-replay";

export const IDEMPOTENCY_TTL_MS = 72 * 60 * 60 * 1000;

export interface IdempotencyContext {
  key: string;
  actorUid: string;
  role: TransactionRole;
  endpoint: string;
  docId: string;
  requestHash: string;
  replayed: boolean;
}

export interface IdempotentOutcome<R> {
  response: R;
  replayed: boolean;
}

export function extractIdempotencyKey(request: Request): string {
  const raw = request.headers.get(IDEMPOTENCY_HEADER);
  if (raw === null) throw new ValidationError("Idempotency-Key header is required.");
  const key = raw.trim();
  if (!UUID_V4_RE.test(key)) throw new ValidationError("Idempotency-Key must be a UUID v4.");
  return key;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const objKey of Object.keys(value as Record<string, unknown>).sort()) {
      out[objKey] = canonicalize((value as Record<string, unknown>)[objKey]);
    }
    return out;
  }
  return value;
}

export function requestHash(body: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(body)))
    .digest("hex");
}

export function buildIdempotencyContext(args: {
  request: Request;
  actorUid: string;
  role: TransactionRole;
  endpoint: string;
  body: unknown;
}): IdempotencyContext {
  const key = extractIdempotencyKey(args.request);
  return {
    key,
    actorUid: args.actorUid,
    role: args.role,
    endpoint: args.endpoint,
    docId: `${args.actorUid}_${key}`,
    requestHash: requestHash(args.body),
    replayed: false,
  };
}

function idempotencyRef(ctx: IdempotencyContext): DocumentReference<IdempotencyDoc> {
  return idempotencyCol().doc(ctx.docId);
}

export async function readReplay<R>(t: Transaction, ctx: IdempotencyContext): Promise<R | null> {
  const existing = (await t.get(idempotencyRef(ctx))).data();
  if (!existing) return null;
  if (existing.requestHash !== ctx.requestHash) throw new IdempotencyConflictError();
  return JSON.parse(existing.responseJson) as R;
}

export function recordResult(
  t: Transaction,
  ctx: IdempotencyContext,
  response: unknown,
  ledgerEntryId?: string,
): void {
  const now = Timestamp.now();
  const doc: IdempotencyDoc = {
    actorUid: ctx.actorUid,
    endpoint: ctx.endpoint,
    requestHash: ctx.requestHash,
    responseJson: JSON.stringify(response),
    createdAt: now,
    expiresAt: Timestamp.fromMillis(now.toMillis() + IDEMPOTENCY_TTL_MS),
    ...(ledgerEntryId !== undefined ? { ledgerEntryId } : {}),
  };
  t.create(idempotencyRef(ctx), doc);
}

type PrefetchRefs = readonly DocumentReference<DocumentData>[];

type SnapshotsFor<P extends PrefetchRefs> = {
  [K in keyof P]: P[K] extends DocumentReference<infer T> ? DocumentSnapshot<T> : never;
};

export async function runIdempotent<R, const P extends PrefetchRefs = []>(
  ctx: IdempotencyContext,
  prefetch: P,
  execute: (
    t: Transaction,
    actor: UserDoc,
    prefetched: SnapshotsFor<P>,
  ) => Promise<{ response: R; ledgerEntryId?: string }>,
): Promise<IdempotentOutcome<R>> {
  const outcome = await getAdminFirestore().runTransaction(async (transaction) => {
    const replay = await readReplay<R>(transaction, ctx);
    if (replay !== null) return { response: replay, replayed: true };

    const [actorSnapshot, ...prefetched] = await transaction.getAll<DocumentData, DocumentData>(
      usersCol().doc(ctx.actorUid),
      ...prefetch,
    );
    const actor = assertActorAuthorized(actorSnapshot?.data() as UserDoc | undefined, ctx.role);
    const { response, ledgerEntryId } = await execute(
      transaction,
      actor,
      prefetched as SnapshotsFor<P>,
    );
    recordResult(transaction, ctx, response, ledgerEntryId);
    return { response, replayed: false };
  });
  ctx.replayed = outcome.replayed;
  return outcome;
}
