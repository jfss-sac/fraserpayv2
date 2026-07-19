import "server-only";
import { createHash } from "node:crypto";
import { type DocumentReference, type Transaction, Timestamp } from "firebase-admin/firestore";
import { type IdempotencyDoc, idempotencyCol } from "./db";
import { IdempotencyConflictError, ValidationError } from "./errors";
import { getAdminFirestore } from "./firebase-admin";

export const IDEMPOTENCY_HEADER = "idempotency-key";

export const IDEMPOTENCY_TTL_MS = 72 * 60 * 60 * 1000;

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface IdempotencyContext {
  key: string;
  actorUid: string;
  endpoint: string;
  docId: string;
  requestHash: string;
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
  endpoint: string;
  body: unknown;
}): IdempotencyContext {
  const key = extractIdempotencyKey(args.request);
  return {
    key,
    actorUid: args.actorUid,
    endpoint: args.endpoint,
    docId: `${args.actorUid}_${key}`,
    requestHash: requestHash(args.body),
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

export async function runIdempotent<R>(
  ctx: IdempotencyContext,
  execute: (t: Transaction) => Promise<{ response: R; ledgerEntryId?: string }>,
): Promise<IdempotentOutcome<R>> {
  return getAdminFirestore().runTransaction(async (t) => {
    const replay = await readReplay<R>(t, ctx);
    if (replay !== null) return { response: replay, replayed: true };
    const { response, ledgerEntryId } = await execute(t);
    recordResult(t, ctx, response, ledgerEntryId);
    return { response, replayed: false };
  });
}
