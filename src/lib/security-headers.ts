const isDev = process.env.NODE_ENV === "development";

// script-src carries a per-request nonce (minted in src/proxy.ts) instead of
// 'unsafe-inline'. Next's App Router emits inline bootstrap scripts
// (self.__next_f.push) that vary per render; Next stamps them — and the wallet
// refresh script — with the nonce it reads from the request CSP header, so no
// static hash or 'unsafe-inline' is needed. 'self' still covers Next's static
// chunks and the Firebase gapi loader (host-source below), so 'strict-dynamic'
// is intentionally omitted.
//
// Firebase Auth (signInWithPopup, Google provider) loads Google-hosted OAuth
// infrastructure during sign-in on /login: the gapi loader script, the auth
// handler iframe on the project's *.firebaseapp.com authDomain, and XHRs to the
// Identity Toolkit / Secure Token APIs. These origins are required for sign-in
// and are used by no other route. (Deviates from a strictly self-only CSP)
const FIREBASE_AUTH_SCRIPT_SRC = "https://apis.google.com";
const FIREBASE_AUTH_CONNECT_SRC =
  "https://identitytoolkit.googleapis.com https://securetoken.googleapis.com";
const FIREBASE_AUTH_FRAME_SRC =
  "https://apis.google.com https://accounts.google.com https://*.firebaseapp.com";

// Dev-only: with NEXT_PUBLIC_USE_EMULATORS the browser SDK talks to the local
// Auth/Firestore emulators (XHRs + the sign-in relay iframe) and Next's HMR
// socket, none of which exist in production. Gated on isDev so the deployed CSP
// never allows localhost origins. In dev we also drop upgrade-insecure-requests
// (it would rewrite the plaintext http/ws emulator + HMR URLs to https/wss,
// which the local servers don't speak) and allow inline styles (Next's dev
// overlay, next/font, and React hydration inject them).
const EMULATOR_CONNECT_SRC =
  "http://127.0.0.1:9099 http://localhost:9099 http://127.0.0.1:8080 http://localhost:8080";
const EMULATOR_WS_SRC =
  "ws://127.0.0.1:3000 ws://localhost:3000 ws://127.0.0.1:8080 ws://localhost:8080";
const EMULATOR_FRAME_SRC = "http://127.0.0.1:9099 http://localhost:9099";

export function buildContentSecurityPolicy(nonce: string): string {
  const directives: string[] = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""} ${FIREBASE_AUTH_SCRIPT_SRC}`,
    `style-src 'self'${isDev ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' data:",
    `connect-src 'self' ${FIREBASE_AUTH_CONNECT_SRC}${isDev ? ` ${EMULATOR_CONNECT_SRC} ${EMULATOR_WS_SRC}` : ""}`,
    "font-src 'self'",
    `frame-src ${FIREBASE_AUTH_FRAME_SRC}${isDev ? ` ${EMULATOR_FRAME_SRC}` : ""}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    isDev ? "" : "upgrade-insecure-requests",
  ];
  return directives.filter(Boolean).join("; ");
}

// The CSP itself is set per-request in src/proxy.ts (it needs the nonce). These
// baseline headers are static and apply to every response via next.config.ts.
// HSTS is production-only: served over plaintext http on localhost it would be
// cached by the browser and force every dev http/ws request to https/wss, which
// the dev server and emulators don't speak.
export const baselineSecurityHeaders = [
  ...(isDev
    ? []
    : [
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      ]),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

export const securityHeaders = [
  { source: "/(.*)", headers: [...baselineSecurityHeaders] },
  {
    source: "/sw.js",
    headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
  },
];
