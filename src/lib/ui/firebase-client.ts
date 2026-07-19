"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type Auth,
} from "firebase/auth";
import { SCHOOL_DOMAIN } from "@/lib/shared/constants";

function readConfig() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (!apiKey || !authDomain || !projectId || !appId) {
    throw new Error("Missing NEXT_PUBLIC_FIREBASE_* configuration.");
  }
  return { apiKey, authDomain, projectId, appId };
}

let cachedAuth: Auth | undefined;

function getClientAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(readConfig());
  const auth = getAuth(app);
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === "true") {
    const host = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
    connectAuthEmulator(auth, `http://${host}`, { disableWarnings: true });
  }
  cachedAuth = auth;
  return auth;
}

const CANCELLED_CODES = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/user-cancelled",
]);

export interface GoogleSignInResult {
  idToken: string;
  email: string;
  emailVerified: boolean;
}

export async function getGoogleIdToken(): Promise<GoogleSignInResult | null> {
  const auth = getClientAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: SCHOOL_DOMAIN, prompt: "select_account" });
  try {
    const credential = await signInWithPopup(auth, provider);
    const idToken = await credential.user.getIdToken();
    const email = credential.user.email ?? "";
    const emailVerified = credential.user.emailVerified;
    await signOut(auth);
    return { idToken, email, emailVerified };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code && CANCELLED_CODES.has(code)) return null;
    throw err;
  }
}
