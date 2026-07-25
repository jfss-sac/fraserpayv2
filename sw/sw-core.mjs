export const CACHE_PREFIX = "fraserpay-cache";

export const PURGE_CACHES_MESSAGE = "fraserpay/purge-caches";

export const STRATEGY = {
  NEVER_CACHE: "never-cache",
  STATIC_CACHE_FIRST: "static-cache-first",
  HTML_CACHE_FIRST: "html-cache-first",
  PASSTHROUGH: "passthrough",
};

const SHELL_ROUTES = ["/wallet", "/sell"];

export function isShellRoute(pathname) {
  return SHELL_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/favicon.ico"
  );
}

export function selectStrategy({ method, sameOrigin, pathname, isNavigate }) {
  if (method !== "GET" || !sameOrigin) return STRATEGY.PASSTHROUGH;
  if (pathname === "/api" || pathname.startsWith("/api/")) return STRATEGY.NEVER_CACHE;
  if (isStaticAsset(pathname)) return STRATEGY.STATIC_CACHE_FIRST;
  if (isNavigate && isShellRoute(pathname)) return STRATEGY.HTML_CACHE_FIRST;
  return STRATEGY.PASSTHROUGH;
}

export function cacheName(version) {
  return `${CACHE_PREFIX}-${version}`;
}

export function isManagedCache(name) {
  return name.startsWith(`${CACHE_PREFIX}-`);
}

export function isStaleCache(name, version) {
  return isManagedCache(name) && name !== cacheName(version);
}

export function cachesToPurge(names) {
  return names.filter(isManagedCache);
}
