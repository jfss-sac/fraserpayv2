"use client";

import { useCallback, useRef } from "react";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function idempotencyScope(endpoint: string, body: unknown): string {
  return `${endpoint}\n${JSON.stringify(canonicalize(body))}`;
}

export function useIdempotencyKey() {
  const held = useRef<Map<string, string> | null>(null);

  const keyFor = useCallback((endpoint: string, body: unknown): string => {
    const map = (held.current ??= new Map());
    const scope = idempotencyScope(endpoint, body);
    let key = map.get(scope);
    if (!key) {
      key = crypto.randomUUID();
      map.set(scope, key);
    }
    return key;
  }, []);

  const hold = useCallback((endpoint: string, body: unknown, key: string) => {
    (held.current ??= new Map()).set(idempotencyScope(endpoint, body), key);
  }, []);

  const isHeld = useCallback(
    (endpoint: string, body: unknown): boolean =>
      held.current?.has(idempotencyScope(endpoint, body)) ?? false,
    [],
  );

  const release = useCallback((endpoint: string, body: unknown) => {
    held.current?.delete(idempotencyScope(endpoint, body));
  }, []);

  return { keyFor, hold, isHeld, release };
}
