import "server-only";
import { type App, cert, getApps, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { type Firestore, getFirestore } from "firebase-admin/firestore";

let cached: App | undefined;

function usingEmulators(): boolean {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

function createApp(): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0]!;

  if (usingEmulators()) {
    const projectId =
      process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "demo-fraserpay";
    return initializeApp({ projectId });
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase admin credentials: set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY (or point at the emulators).",
    );
  }
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

export function getAdminApp(): App {
  if (!cached) cached = createApp();
  return cached;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminFirestore(): Firestore {
  return getFirestore(getAdminApp());
}
