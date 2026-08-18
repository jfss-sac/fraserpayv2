"use client";

import type { BoothRegistrationInput } from "@/lib/shared/booth";
import type { BoothItem } from "@/lib/shared/types";
import { ApiError, NETWORK_ERROR_MESSAGE, postJson } from "@/lib/ui/api-client";

export interface PriceEdit {
  id: string;
  priceCents: number;
}

export interface NewItem {
  name: string;
  priceCents: number;
}

export interface CreatedBooth {
  boothId: string;
  status: "approved";
  joinCode: string;
}

export function boothActionErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return NETWORK_ERROR_MESSAGE;
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

export function createBooth(input: BoothRegistrationInput): Promise<CreatedBooth> {
  return postJson("/api/exec/booths", input);
}

export function editPrices(
  boothId: string,
  priceEdits: PriceEdit[],
): Promise<{ boothId: string; items: BoothItem[] }> {
  return postJson(`/api/exec/booths/${encodeURIComponent(boothId)}/items`, { priceEdits });
}

export function addItem(
  boothId: string,
  item: NewItem,
): Promise<{ boothId: string; item: BoothItem }> {
  return postJson(`/api/exec/booths/${encodeURIComponent(boothId)}/items/add`, item);
}

export function archiveItem(
  boothId: string,
  itemId: string,
  archived: boolean,
): Promise<{ boothId: string; itemId: string; archived: boolean }> {
  return postJson(`/api/exec/booths/${encodeURIComponent(boothId)}/items/archive`, {
    itemId,
    archived,
  });
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
