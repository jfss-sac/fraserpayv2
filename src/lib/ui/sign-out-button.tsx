"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PURGE_CACHES_MESSAGE } from "../../../sw/sw-core.mjs";

const PURGE_TIMEOUT_MS = 2000;

const SIGN_OUT_FAILED_MESSAGE =
  "Sign-out failed — you're still signed in. Check your connection and try again.";

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
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setPending(true);
    setError(null);

    let response: Response;
    try {
      response = await fetch("/api/auth/signout", { method: "POST", credentials: "same-origin" });
    } catch {
      setError(SIGN_OUT_FAILED_MESSAGE);
      setPending(false);
      return;
    }

    if (!response.ok && response.status !== 401) {
      setError(SIGN_OUT_FAILED_MESSAGE);
      setPending(false);
      return;
    }

    await purgeServiceWorkerCaches();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleSignOut}
        disabled={pending}
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted disabled:opacity-60"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error ? (
        <p role="alert" className="max-w-64 text-right text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
