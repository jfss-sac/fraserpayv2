"use client";

import { useState } from "react";
import { boothJoinSchema } from "@/lib/shared/booth";

async function messageForResponse(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error?.message === "string") return body.error.message;
  } catch {}
  return "Couldn't join. Please try again.";
}

export function BoothJoinForm() {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = boothJoinSchema.safeParse({ code });
    if (!parsed.success) {
      setError("Enter your booth join code.");
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/booths/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        setError(await messageForResponse(res));
        setPending(false);
        return;
      }
      const body = (await res.json()) as { name: string };
      setJoined(body.name);
    } catch {
      setError("Couldn't join. Please try again.");
      setPending(false);
    }
  }

  if (joined) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-foreground">You&apos;re in</h2>
        <p className="text-sm text-foreground">
          You&apos;re now a member of <span className="font-medium">{joined}</span>. It will appear
          in your sell mode.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="join-code" className="text-sm font-medium text-foreground">
          Join code
        </label>
        <input
          id="join-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="TACO-4F2"
          className="rounded-md border border-border px-3 py-2 uppercase"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand px-4 py-3 font-medium text-brand-foreground disabled:opacity-60"
      >
        {pending ? "Joining…" : "Join booth"}
      </button>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
