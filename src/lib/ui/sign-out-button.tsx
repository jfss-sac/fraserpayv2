"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PURGE_CACHES_MESSAGE } from "../../../sw/sw-core.mjs";

const PURGE_TIMEOUT_MS = 2000;

async function purgeServiceWorkerCaches(): Promise<void> {
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

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await fetch("/api/auth/signout", { method: "POST", credentials: "same-origin" });
    } catch {}
    await purgeServiceWorkerCaches();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
