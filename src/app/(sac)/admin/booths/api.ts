"use client";

import type { BoothItem } from "@/lib/shared/types";

export interface PriceEdit {
  id: string;
  priceCents: number;
}

export class BoothApiError extends Error {
  constructor(
    readonly code: string,
    readonly serverMessage: string,
  ) {
    super(code);
    this.name = "BoothApiError";
  }
}

async function envelopeOf(res: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return { code: body.error?.code ?? "INTERNAL", message: body.error?.message ?? "" };
  } catch {
    return { code: "INTERNAL", message: "" };
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const { code, message } = await envelopeOf(res);
    throw new BoothApiError(code, message);
  }
  return (await res.json()) as T;
}

const NETWORK = "Couldn't reach the server. Check your connection and try again.";

export function boothActionErrorMessage(err: unknown): string {
  if (!(err instanceof BoothApiError)) return NETWORK;
  switch (err.code) {
    case "CONFLICT":
      return err.serverMessage || "That action conflicts with the booth's current state.";
    case "VALIDATION":
      return err.serverMessage || "Check the values and try again.";
    case "NOT_FOUND":
      return "Booth not found.";
    case "RATE_LIMITED":
      return "Too many actions — wait a moment and try again.";
    default:
      return "That action failed. Try again.";
  }
}

export function approveBooth(
  boothId: string,
  priceEdits: PriceEdit[],
): Promise<{ boothId: string; status: "approved"; joinCode: string }> {
  const body = priceEdits.length > 0 ? { priceEdits } : {};
  return postJson(`/api/exec/booths/${encodeURIComponent(boothId)}/approve`, body);
}

export function editPrices(
  boothId: string,
  priceEdits: PriceEdit[],
): Promise<{ boothId: string; items: BoothItem[] }> {
  return postJson(`/api/exec/booths/${encodeURIComponent(boothId)}/items`, { priceEdits });
}

export function rotateCode(boothId: string): Promise<{ boothId: string; joinCode: string }> {
  return postJson(`/api/exec/booths/${encodeURIComponent(boothId)}/rotate-code`, {});
}

export function removeMember(
  boothId: string,
  uid: string,
): Promise<{ boothId: string; uid: string }> {
  return postJson(`/api/exec/booths/${encodeURIComponent(boothId)}/members/remove`, { uid });
}

export function setActive(
  boothId: string,
  active: boolean,
): Promise<{ boothId: string; status: BoothStatusLike }> {
  return postJson(`/api/exec/booths/${encodeURIComponent(boothId)}/status`, { active });
}

type BoothStatusLike = "approved" | "deactivated";
