import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PING_INTERVAL_MS, useConnectivity } from "./use-connectivity";

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  setOnLine(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setOnLine(true);
});

test("stays online while the ping succeeds", async () => {
  const probe = vi.fn().mockResolvedValue(true);
  const { result } = renderHook(() => useConnectivity({ probe }));
  await flush();
  expect(result.current).toBe(true);
  expect(probe).toHaveBeenCalled();
});

test("treats a failing ping as offline even when the browser claims to be online", async () => {
  const probe = vi.fn().mockResolvedValue(false);
  const { result } = renderHook(() => useConnectivity({ probe }));
  await flush();
  expect(result.current).toBe(false);
});

test("goes offline immediately on the browser offline event without pinging", async () => {
  const probe = vi.fn().mockResolvedValue(true);
  const { result } = renderHook(() => useConnectivity({ probe }));
  await flush();
  expect(result.current).toBe(true);
  probe.mockClear();

  await act(async () => {
    setOnLine(false);
    window.dispatchEvent(new Event("offline"));
  });

  expect(result.current).toBe(false);
  expect(probe).not.toHaveBeenCalled();
});

test("never pings while the browser reports offline", async () => {
  setOnLine(false);
  const probe = vi.fn().mockResolvedValue(true);
  const { result } = renderHook(() => useConnectivity({ probe }));
  await flush();
  expect(result.current).toBe(false);
  expect(probe).not.toHaveBeenCalled();
});

test("auto-recovers when the browser reconnects and the ping confirms", async () => {
  setOnLine(false);
  const probe = vi.fn().mockResolvedValue(true);
  const { result } = renderHook(() => useConnectivity({ probe }));
  await flush();
  expect(result.current).toBe(false);

  await act(async () => {
    setOnLine(true);
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
  });

  expect(result.current).toBe(true);
});

test("re-probes on the interval and downgrades on lie-fi", async () => {
  const probe = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
  const { result } = renderHook(() => useConnectivity({ probe }));
  await flush();
  expect(result.current).toBe(true);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
  });

  expect(result.current).toBe(false);
});
