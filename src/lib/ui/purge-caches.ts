"use client";

import { PURGE_CACHES_MESSAGE } from "../../../sw/sw-core.mjs";

const PURGE_TIMEOUT_MS = 2000;

export async function purgeServiceWorkerCaches(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const worker = (await navigator.serviceWorker.getRegistration())?.active;
  if (!worker) return;
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(resolve, PURGE_TIMEOUT_MS);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve();
    };
    worker.postMessage({ type: PURGE_CACHES_MESSAGE }, [channel.port2]);
  });
}
