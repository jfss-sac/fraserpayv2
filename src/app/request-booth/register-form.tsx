"use client";

import { useEffect, useRef, useState } from "react";
import { boothRegistrationSchema } from "@/lib/shared/booth";
import {
  BOOTH_DRAFT_AUTOSAVE_DEBOUNCE_MS,
  clearBoothDraft,
  emptyBoothDraft,
  loadBoothDraft,
  type BoothDraft,
  type BoothDraftItem,
  normalizeBoothDraft,
  saveBoothDraft,
} from "@/lib/ui/booth-draft";

function priceToCents(price: string): number {
  return Math.round(Number(price) * 100);
}

async function messageForResponse(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error?.message === "string") return body.error.message;
  } catch {}
  return "Registration failed. Please try again.";
}

export function BoothRegisterForm({ actorUid }: { actorUid: string }) {
  const [draft, setDraft] = useState<BoothDraft>(() => emptyBoothDraft());
  const [restoreDraft, setRestoreDraft] = useState<BoothDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const loaded = loadBoothDraft(actorUid);
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setDraft(emptyBoothDraft());
      setRestoreDraft(loaded.status === "available" ? loaded.draft : null);
      setDraftReady(true);
      if (loaded.status === "blocked") setStorageWarning(true);
    });
    return () => {
      active = false;
    };
  }, [actorUid]);

  useEffect(() => {
    if (!draftReady || restoreDraft !== null || submitted) return;
    function saveImmediately() {
      if (saveBoothDraft(actorUid, draft) === "blocked") setStorageWarning(true);
    }

    window.addEventListener("pagehide", saveImmediately);
    const timer = setTimeout(() => {
      autosaveTimer.current = null;
      saveImmediately();
    }, BOOTH_DRAFT_AUTOSAVE_DEBOUNCE_MS);
    autosaveTimer.current = timer;

    return () => {
      window.removeEventListener("pagehide", saveImmediately);
      clearTimeout(timer);
      if (autosaveTimer.current === timer) autosaveTimer.current = null;
    };
  }, [actorUid, draft, draftReady, restoreDraft, submitted]);

  function updateItem(index: number, patch: Partial<BoothDraftItem>) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  }

  function addItem() {
    setDraft((current) => ({ ...current, items: [...current.items, { name: "", price: "" }] }));
  }

  function removeItem(index: number) {
    setDraft((current) => ({
      ...current,
      items:
        current.items.length === 1 ? current.items : current.items.filter((_, i) => i !== index),
    }));
  }

  function restore() {
    if (restoreDraft === null) return;
    setDraft(normalizeBoothDraft(restoreDraft) ?? emptyBoothDraft());
    setRestoreDraft(null);
  }

  function discard() {
    if (clearBoothDraft(actorUid) === "blocked") setStorageWarning(true);
    setDraft(emptyBoothDraft());
    setRestoreDraft(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const payload = {
      name: draft.name,
      description: draft.description,
      items: draft.items.map((item) => ({ name: item.name, priceCents: priceToCents(item.price) })),
    };
    const parsed = boothRegistrationSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/booths/register", {
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
      if (autosaveTimer.current !== null) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
      if (clearBoothDraft(actorUid) === "blocked") setStorageWarning(true);
      setPending(false);
      setSubmitted(true);
    } catch {
      setError("Registration didn't complete. Please try again.");
      setPending(false);
    }
  }

  if (submitted) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-foreground">Booth submitted</h2>
        <p className="text-sm text-foreground">
          SAC will review your booth and email you a join code once it&apos;s approved.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {storageWarning ? (
        <p role="status" className="text-xs text-muted">
          Draft autosave isn&apos;t available on this device. You can still submit this form.
        </p>
      ) : null}

      {restoreDraft ? (
        <div
          role="alertdialog"
          aria-labelledby="restore-draft-title"
          className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4"
        >
          <p id="restore-draft-title" className="font-medium text-foreground">
            Restore your draft?
          </p>
          <p className="text-sm text-muted">This device has an unfinished booth request.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={restore}
              className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-foreground"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={discard}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="booth-name" className="text-sm font-medium text-foreground">
            Booth name
          </label>
          <input
            id="booth-name"
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            className="rounded-md border border-border px-3 py-2"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="booth-description" className="text-sm font-medium text-foreground">
            Description
          </label>
          <textarea
            id="booth-description"
            value={draft.description}
            onChange={(event) =>
              setDraft((current) => ({ ...current, description: event.target.value }))
            }
            className="rounded-md border border-border px-3 py-2"
          />
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium text-foreground">
            Items (prices in $0.50 steps)
          </legend>
          {draft.items.map((item, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <label htmlFor={`item-name-${index}`} className="text-xs text-foreground">
                  Item name
                </label>
                <input
                  id={`item-name-${index}`}
                  value={item.name}
                  onChange={(event) => updateItem(index, { name: event.target.value })}
                  className="rounded-md border border-border px-3 py-2"
                />
              </div>
              <div className="flex w-28 flex-col gap-1">
                <label htmlFor={`item-price-${index}`} className="text-xs text-foreground">
                  Price ($)
                </label>
                <input
                  id={`item-price-${index}`}
                  inputMode="decimal"
                  value={item.price}
                  onChange={(event) => updateItem(index, { price: event.target.value })}
                  className="rounded-md border border-border px-3 py-2"
                />
              </div>
              <button
                type="button"
                onClick={() => removeItem(index)}
                disabled={draft.items.length === 1}
                className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addItem}
            className="self-start rounded-md border border-border px-3 py-2 text-sm"
          >
            Add item
          </button>
        </fieldset>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-4 py-3 font-medium text-brand-foreground disabled:opacity-60"
        >
          {pending ? "Submitting…" : "Submit for review"}
        </button>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
