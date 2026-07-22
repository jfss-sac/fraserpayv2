"use client";

import { useState } from "react";
import { boothRegistrationSchema } from "@/lib/shared/booth";

interface ItemRow {
  name: string;
  price: string;
}

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

export function BoothRegisterForm() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<ItemRow[]>([{ name: "", price: "" }]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addItem() {
    setItems((rows) => [...rows, { name: "", price: "" }]);
  }

  function removeItem(index: number) {
    setItems((rows) => (rows.length === 1 ? rows : rows.filter((_, i) => i !== index)));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const payload = {
      name,
      description,
      items: items.map((row) => ({ name: row.name, priceCents: priceToCents(row.price) })),
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="booth-name" className="text-sm font-medium text-foreground">
          Booth name
        </label>
        <input
          id="booth-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-border px-3 py-2"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="booth-description" className="text-sm font-medium text-foreground">
          Description
        </label>
        <textarea
          id="booth-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-md border border-border px-3 py-2"
        />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-foreground">
          Items (prices in $0.50 steps)
        </legend>
        {items.map((row, index) => (
          <div key={index} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor={`item-name-${index}`} className="text-xs text-foreground">
                Item name
              </label>
              <input
                id={`item-name-${index}`}
                value={row.name}
                onChange={(e) => updateItem(index, { name: e.target.value })}
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
                value={row.price}
                onChange={(e) => updateItem(index, { price: e.target.value })}
                className="rounded-md border border-border px-3 py-2"
              />
            </div>
            <button
              type="button"
              onClick={() => removeItem(index)}
              disabled={items.length === 1}
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
  );
}
