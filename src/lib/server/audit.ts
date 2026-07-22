import "server-only";
import {
  type DocumentData,
  type DocumentReference,
  Timestamp,
  type Transaction,
  type WriteBatch,
} from "firebase-admin/firestore";
import { type AuditLogDoc, auditCol } from "./db";
import type { AuditAction } from "@/lib/shared/types";

export type AuditWriter = Transaction | WriteBatch;

export interface AuditActor {
  uid: string;
  displayName: string;
}

export interface AuditTarget {
  type: "booth" | "user";
  id: string;
  label: string;
}

export function writeAudit(
  writer: AuditWriter,
  action: AuditAction,
  actor: AuditActor,
  target: AuditTarget,
  details: DocumentData = {},
): DocumentReference<AuditLogDoc> {
  const ref = auditCol().doc();
  const entry: AuditLogDoc = {
    action,
    actorUid: actor.uid,
    actorName: actor.displayName,
    targetType: target.type,
    targetId: target.id,
    targetLabel: target.label,
    details,
    createdAt: Timestamp.now(),
  };
  writer.create(ref, entry);
  return ref;
}
