const isDev = process.env.NODE_ENV === "development";

// TODO: will replace 'unsafe-inline' with per-script hashes. Next's App
// Router emits inline bootstrap scripts (self.__next_f.push) that a nonce/hash
// scheme will cover; until then
// 'unsafe-inline' is required for the page to hydrate without CSP violations.
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

const cspDirectives: string[] = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${FIREBASE_AUTH_SCRIPT_SRC}`,
  "style-src 'self'",
  "img-src 'self' data:",
  `connect-src 'self' ${FIREBASE_AUTH_CONNECT_SRC}`,
  "font-src 'self'",
  `frame-src ${FIREBASE_AUTH_FRAME_SRC}`,
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
];

export const contentSecurityPolicy = cspDirectives.join("; ");

export const baselineSecurityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
] as const;

export const securityHeaders = [
  { source: "/(.*)", headers: [...baselineSecurityHeaders] },
  {
    source: "/sw.js",
    headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
  },
];
