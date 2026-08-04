import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { BuyerId } from "@/lib/ui/scanner";
import { type TopUpSubmission, useTopUp } from "./use-topup";

const BUYER: BuyerId = { studentNumber: "123456" };
const SUBMISSION: TopUpSubmission = { buyer: BUYER, amountCents: 1000, method: "cash" };

function okResponse(result: unknown): Response {
  return { ok: true, json: async () => result } as Response;
}

function errorResponse(code: string): Response {
  return { ok: false, json: async () => ({ error: { code } }) } as Response;
}

function keyOf(call: unknown[]): string | null {
  return new Headers((call[1] as RequestInit).headers).get("idempotency-key");
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("reuses the idempotency key when the same top-up is retried after a network failure", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useTopUp({}));
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });
  expect(result.current.state).toEqual({ status: "error", code: "NETWORK" });
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });

  expect(fetchMock).toHaveBeenCalledTimes(6);
  expect(new Set(fetchMock.mock.calls.map(keyOf)).size).toBe(1);
});

test("mints a fresh idempotency key for an identical top-up after success", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse({ entryId: "e1" }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useTopUp({}));
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(keyOf(fetchMock.mock.calls[0]!)).not.toBe(keyOf(fetchMock.mock.calls[1]!));
});

test("mints a fresh idempotency key when an override reason is added after a cap rejection", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(errorResponse("CAP_EXCEEDED"))
    .mockResolvedValue(okResponse({ entryId: "e1" }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useTopUp({}));
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });
  await act(async () => {
    await result.current.submit({ ...SUBMISSION, overrideReason: "principal approved" });
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(keyOf(fetchMock.mock.calls[0]!)).not.toBe(keyOf(fetchMock.mock.calls[1]!));
});
