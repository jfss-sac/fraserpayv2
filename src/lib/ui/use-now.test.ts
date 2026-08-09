import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useNow } from "./use-now";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("advances on its interval and stops once unmounted", () => {
  const { result, unmount } = renderHook(() => useNow(5000));
  const first = result.current;

  act(() => {
    vi.advanceTimersByTime(5000);
  });
  const second = result.current;
  expect(second).toBeGreaterThan(first);

  unmount();
  act(() => {
    vi.advanceTimersByTime(5000);
  });
  expect(result.current).toBe(second);
});
