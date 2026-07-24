"use client";

import { useEffect, useRef, useState } from "react";

export const PING_URL = "/";
export const PING_INTERVAL_MS = 20000;
export const PING_TIMEOUT_MS = 5000;

export type Probe = () => Promise<boolean>;

export async function defaultProbe(url = PING_URL, timeoutMs = PING_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function browserOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function useConnectivity(opts: { probe?: Probe; intervalMs?: number } = {}): boolean {
  const { probe = defaultProbe, intervalMs = PING_INTERVAL_MS } = opts;
  const [online, setOnline] = useState(browserOnline);
  const probeRef = useRef(probe);
  useEffect(() => {
    probeRef.current = probe;
  }, [probe]);

  useEffect(() => {
    let seq = 0;
    let cancelled = false;

    const run = async () => {
      const mine = ++seq;
      if (!browserOnline()) {
        if (!cancelled && mine === seq) setOnline(false);
        return;
      }
      const ok = await probeRef.current();
      if (!cancelled && mine === seq) setOnline(ok);
    };

    const onOffline = () => {
      seq += 1;
      setOnline(false);
    };
    const onOnline = () => void run();

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    void run();
    const id = setInterval(() => void run(), intervalMs);

    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [intervalMs]);

  return online;
}
