"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SCHOOL_DOMAIN } from "@/lib/shared/constants";
import { purgeServiceWorkerCaches } from "@/lib/ui/purge-caches";
import { safeRedirectPath } from "@/lib/shared/safe-redirect";

const WRONG_DOMAIN_MESSAGE = `Use your @${SCHOOL_DOMAIN} school Google account — personal accounts can't sign in.`;

async function messageForResponse(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body?.error?.code === "FORBIDDEN") return WRONG_DOMAIN_MESSAGE;
    if (typeof body?.error?.message === "string") return body.error.message;
  } catch {}
  return "Sign-in failed. Please try again.";
}

export function GoogleSignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void purgeServiceWorkerCaches();
  }, []);

  async function handleSignIn() {
    setPending(true);
    setError(null);
    try {
      const { getGoogleIdToken } = await import("@/lib/ui/firebase-client");
      const result = await getGoogleIdToken();
      if (!result) {
        setPending(false);
        return;
      }
      if (!result.emailVerified || !result.email.toLowerCase().endsWith(`@${SCHOOL_DOMAIN}`)) {
        setError(WRONG_DOMAIN_MESSAGE);
        setPending(false);
        return;
      }
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ idToken: result.idToken }),
      });
      if (!res.ok) {
        setError(await messageForResponse(res));
        setPending(false);
        return;
      }
      await purgeServiceWorkerCaches();
      router.replace(safeRedirectPath(searchParams.get("next"), "/"));
    } catch {
      setError("Sign-in didn't complete. Please try again.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleSignIn}
        disabled={pending}
        className="rounded-md bg-brand px-4 py-3 font-medium text-brand-foreground disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Continue with Google"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
