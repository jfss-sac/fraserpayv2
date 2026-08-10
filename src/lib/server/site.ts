import "server-only";
import { headers } from "next/headers";

export const SITE_NAME = "FraserPay";

export const SITE_ALTERNATE_NAMES = ["Fraser Pay", "Fraser Pay app", "FraserPay wallet"];

export const SITE_TAGLINE = "Cashless credit for school events";

export const SITE_DESCRIPTION =
  "FraserPay is the cashless credit system for school events. Students load credit at the SAC table, then pay student-run booths with a QR code — no cash at the booth, and every cent traceable to an append-only ledger.";

export const FALLBACK_ORIGIN = "http://localhost:3000";

const SAFE_HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

function normalize(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

function isLoopback(host: string): boolean {
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

export function resolveOrigin(
  configured: string | undefined,
  forwardedHost: string | null,
  host: string | null,
  forwardedProto: string | null,
): string {
  if (configured && configured.trim()) {
    try {
      return normalize(new URL(configured.trim()).origin);
    } catch {
      return FALLBACK_ORIGIN;
    }
  }

  const candidate = (forwardedHost ?? host ?? "").split(",")[0]!.trim();
  if (!SAFE_HOST.test(candidate)) return FALLBACK_ORIGIN;

  const forwarded = forwardedProto?.split(",")[0]?.trim().toLowerCase();
  const proto =
    forwarded === "http" || forwarded === "https"
      ? forwarded
      : isLoopback(candidate)
        ? "http"
        : "https";
  return normalize(`${proto}://${candidate}`);
}

export async function siteOrigin(): Promise<string> {
  const h = await headers();
  return resolveOrigin(
    process.env.NEXT_PUBLIC_SITE_URL,
    h.get("x-forwarded-host"),
    h.get("host"),
    h.get("x-forwarded-proto"),
  );
}

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function canonicalPath(pathname: string | null): string {
  if (!pathname || !pathname.startsWith("/")) return "/";
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return trimmed === "" ? "/" : trimmed;
}

export async function sitePath(): Promise<string> {
  return canonicalPath((await headers()).get("x-pathname"));
}
