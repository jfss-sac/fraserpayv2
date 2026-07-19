import "server-only";
import {
  type CollectionReference,
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type Timestamp,
} from "firebase-admin/firestore";
import { getAdminFirestore } from "./firebase-admin";
import type {
  AuditAction,
  BoothItem,
  BoothStatus,
  LedgerDirection,
  LedgerLineItem,
  LedgerType,
  PaymentMethod,
  SacRoles,
} from "@/lib/shared/types";

export interface UserDoc {
  email: string;
  displayName: string;
  displayNameLower: string;
  studentNumber: string | null;
  paymentCode: string;
  balanceCents: number;
  points: number;
  roles: SacRoles;
  suspended: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BoothDoc {
  name: string;
  nameLower: string;
  description: string;
  status: BoothStatus;
  items: BoothItem[];
  joinCode: string | null;
  submitterUid: string;
  submitterEmail: string;
  createdAt: Timestamp;
  approvedAt?: Timestamp;
  approvedByUid?: string;
}

export interface MemberDoc {
  uid: string;
  displayName: string;
  joinedAt: Timestamp;
}

export interface LedgerEntryDoc {
  type: LedgerType;
  amountCents: number;
  direction: LedgerDirection;
  balanceAfterCents: number;
  studentUid: string;
  studentNumber: string | null;
  studentName: string;
  actorUid: string;
  actorName: string;
  tags: string[];
  idempotencyKey: string;
  createdAt: Timestamp;
  createdDate: string;
  boothId?: string;
  boothName?: string;
  method?: PaymentMethod;
  lineItems?: LedgerLineItem[];
  reason?: string;
  originalEntryId?: string;
  pointsDelta?: number;
}

export interface AuditLogDoc {
  action: AuditAction;
  actorUid: string;
  actorName: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  details: DocumentData;
  createdAt: Timestamp;
}

export interface IdempotencyDoc {
  actorUid: string;
  endpoint: string;
  requestHash: string;
  responseJson: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  ledgerEntryId?: string;
}

export interface RateLimitDoc {
  count: number;
  expiresAt: Timestamp;
}

function pruneUndefined<T extends DocumentData>(model: T): DocumentData {
  const out: DocumentData = {};
  for (const [key, value] of Object.entries(model)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function converter<T extends DocumentData>(): FirestoreDataConverter<T> {
  return {
    toFirestore(model) {
      return pruneUndefined(model as T);
    },
    fromFirestore(snapshot: QueryDocumentSnapshot): T {
      return snapshot.data() as T;
    },
  };
}

const userConverter = converter<UserDoc>();
const boothConverter = converter<BoothDoc>();
const memberConverter = converter<MemberDoc>();
const ledgerConverter = converter<LedgerEntryDoc>();
const auditConverter = converter<AuditLogDoc>();
const idempotencyConverter = converter<IdempotencyDoc>();
const rateLimitConverter = converter<RateLimitDoc>();

export function usersCol(): CollectionReference<UserDoc> {
  return getAdminFirestore().collection("users").withConverter(userConverter);
}

export function boothsCol(): CollectionReference<BoothDoc> {
  return getAdminFirestore().collection("booths").withConverter(boothConverter);
}

export function membersCol(boothId: string): CollectionReference<MemberDoc> {
  return boothsCol().doc(boothId).collection("members").withConverter(memberConverter);
}

export function ledgerCol(): CollectionReference<LedgerEntryDoc> {
  return getAdminFirestore().collection("ledger").withConverter(ledgerConverter);
}

export function auditCol(): CollectionReference<AuditLogDoc> {
  return getAdminFirestore().collection("auditLog").withConverter(auditConverter);
}

export function idempotencyCol(): CollectionReference<IdempotencyDoc> {
  return getAdminFirestore().collection("idempotency").withConverter(idempotencyConverter);
}

export function rateLimitsCol(): CollectionReference<RateLimitDoc> {
  return getAdminFirestore().collection("rateLimits").withConverter(rateLimitConverter);
}
