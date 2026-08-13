"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { purgeServiceWorkerCaches } from "@/lib/ui/purge-caches";

const SIGN_OUT_FAILED_MESSAGE =
  "Sign-out failed — you're still signed in. Check your connection and try again.";

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
