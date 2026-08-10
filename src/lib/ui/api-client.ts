"use client";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly serverMessage = "",
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export const NETWORK_ERROR_MESSAGE =
  "Couldn't reach the server. Check your connection and try again.";

export async function apiErrorOf(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return new ApiError(body.error?.code ?? "INTERNAL", body.error?.message ?? "");
  } catch {
    return new ApiError("INTERNAL");
  }
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal });
  if (!res.ok) throw await apiErrorOf(res);
  return (await res.json()) as T;
}

export async function postJson<T>(url: string, body: unknown, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw await apiErrorOf(res);
  return (await res.json()) as T;
}
