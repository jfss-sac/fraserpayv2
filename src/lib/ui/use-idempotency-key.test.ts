import { renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { idempotencyScope, useIdempotencyKey } from "./use-idempotency-key";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("returns a UUID v4 and holds it for an identical endpoint and body", () => {
  const { result } = renderHook(() => useIdempotencyKey());
  const first = result.current.keyFor("/api/x", { a: 1, b: [2, 3] });
  expect(first).toMatch(UUID_V4_RE);
  expect(result.current.keyFor("/api/x", { b: [2, 3], a: 1 })).toBe(first);
});

test("mints a new key when the body or endpoint changes", () => {
  const { result } = renderHook(() => useIdempotencyKey());
  const first = result.current.keyFor("/api/x", { a: 1 });
  expect(result.current.keyFor("/api/x", { a: 2 })).not.toBe(first);
  const second = result.current.keyFor("/api/x", { a: 2 });
  expect(result.current.keyFor("/api/y", { a: 2 })).not.toBe(second);
});

test("holds keys per scope independently across interleaved operations", () => {
  const { result } = renderHook(() => useIdempotencyKey());
  const adjust = result.current.keyFor("/api/x", { a: 1 });
  result.current.keyFor("/api/y", { b: 2 });
  expect(result.current.keyFor("/api/x", { a: 1 })).toBe(adjust);
});

test("release frees only the released scope", () => {
  const { result } = renderHook(() => useIdempotencyKey());
  const first = result.current.keyFor("/api/x", { a: 1 });
  const other = result.current.keyFor("/api/x", { a: 2 });
  result.current.release("/api/x", { a: 1 });
  expect(result.current.keyFor("/api/x", { a: 1 })).not.toBe(first);
  expect(result.current.keyFor("/api/x", { a: 2 })).toBe(other);
});

test("releaseAll frees every held scope", () => {
  const { result } = renderHook(() => useIdempotencyKey());
  const first = result.current.keyFor("/api/x", { a: 1 });
  result.current.releaseAll();
  expect(result.current.keyFor("/api/x", { a: 1 })).not.toBe(first);
});

test("scope ignores key order and dropped undefined fields like JSON serialization", () => {
  expect(idempotencyScope("/api/x", { a: 1, b: undefined })).toBe(
    idempotencyScope("/api/x", { a: 1 }),
  );
});
