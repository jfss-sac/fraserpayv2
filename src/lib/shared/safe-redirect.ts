const REDIRECT_BASE = "https://fraserpay.invalid";

export function safeRedirectPath(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith("/")) return fallback;
  try {
    const url = new URL(next, REDIRECT_BASE);
    if (url.origin !== REDIRECT_BASE) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
