import { z } from "zod";

const FIRESTORE_DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isFirestoreDocumentId(value: string): boolean {
  return FIRESTORE_DOCUMENT_ID_PATTERN.test(value);
}

export const firestoreDocumentIdSchema = z
  .string()
  .trim()
  .refine(isFirestoreDocumentId, "Must be a valid document id.");
