const isDev = process.env.NODE_ENV === "development";

// TODO: will replace 'unsafe-inline' with per-script hashes. Next's App
// Router emits inline bootstrap scripts (self.__next_f.push) that a nonce/hash
// scheme will cover; until then
// 'unsafe-inline' is required for the page to hydrate without CSP violations.
const cspDirectives: string[] = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
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
