import { type App, getApps, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { SESSION_TTL_MS } from "../../src/lib/shared/constants";

export function adminApp(): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0]!;
  const projectId =
    process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "demo-fraserpay";
  return initializeApp({ projectId });
}

export function db(): Firestore {
  return getFirestore(adminApp());
}

export function auth(): Auth {
  return getAuth(adminApp());
}

export async function mintSessionCookie(uid: string): Promise<string> {
  const customToken = await auth().createCustomToken(uid);
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host) throw new Error("FIREBASE_AUTH_EMULATOR_HOST is unset — run e2e under the emulators.");
  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const body = (await res.json()) as { idToken?: string };
  if (!body.idToken) throw new Error(`emulator did not return an idToken: ${JSON.stringify(body)}`);
  return auth().createSessionCookie(body.idToken, { expiresIn: SESSION_TTL_MS });
}
