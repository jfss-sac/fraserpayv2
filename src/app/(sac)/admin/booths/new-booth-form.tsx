"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_BOOTH_ITEMS } from "@/lib/shared/booth";
import type { BoothRegistrationInput } from "@/lib/shared/booth";
import { isValidAmount } from "@/lib/shared/money";
import { Button } from "@/lib/ui/vendor/button";
import { boothActionErrorMessage, createBooth, type CreatedBooth } from "./api";

interface DraftItem {
  name: string;
  price: string;
}

export function parseDollars(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number.parseFloat(trimmed) * 100);
  return isValidAmount(cents) ? cents : null;
}

const EMPTY_ITEM: DraftItem = { name: "", price: "" };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function NewBoothForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<DraftItem[]>([{ ...EMPTY_ITEM }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedBooth | null>(null);
  const inFlight = useRef(false);

  function resetForm(): void {
    setName("");
    setDescription("");
    setItems([{ ...EMPTY_ITEM }]);
    setError("");
  }

  function closeForm(): void {
    if (busy) return;
    setOpen(false);
    resetForm();
  }

  function updateItem(index: number, patch: Partial<DraftItem>): void {
    setItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  }

  function validate(): BoothRegistrationInput | null {
    const normalizedItems = items.map((item) => ({
      name: item.name.trim(),
      priceCents: parseDollars(item.price),
    }));
    if (!name.trim()) {
      setError("Enter a booth name.");
      return null;
    }
    if (!description.trim()) {
      setError("Enter a booth description.");
      return null;
    }
    if (
      normalizedItems.some(
        (item) => !item.name || item.priceCents === null || item.priceCents === undefined,
      )
    ) {
      setError("Each item needs a name and a positive price in $0.50 steps.");
      return null;
    }
    return {
      name: name.trim(),
      description: description.trim(),
      items: normalizedItems.map((item) => ({ name: item.name, priceCents: item.priceCents! })),
    };
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || inFlight.current) return;
    const input = validate();
    if (!input) return;

    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await createBooth(input);
      setCreated(result);
      setOpen(false);
      resetForm();
      router.refresh();
    } catch (err) {
      setError(boothActionErrorMessage(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (created) {
    return (
      <Card title="Booth created">
        <p className="text-sm text-muted">The booth is approved and ready to sell.</p>
        <div className="rounded-md border border-border bg-background p-4">
          <p className="text-sm text-muted">Email this join code to the booth.</p>
          <p className="mt-2 font-mono text-3xl font-bold tracking-wide text-foreground">
            {created.joinCode}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setCreated(null)}>
          Done
        </Button>
      </Card>
    );
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        New booth ✦
      </Button>
    );
  }

  return (
    <div className="w-full sm:max-w-xl">
      <Card title="New booth">
        <p className="text-sm text-muted">
          Create an approved booth for event day. Add at least one item; Custom is added at 50¢.
        </p>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-1">
            <label htmlFor="new-booth-name" className="text-sm font-medium text-foreground">
              Booth name
            </label>
            <input
              id="new-booth-name"
              type="text"
              value={name}
              maxLength={80}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              className="h-11 rounded-md border border-border bg-background px-3 text-base text-foreground"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="new-booth-description" className="text-sm font-medium text-foreground">
              Description
            </label>
            <textarea
              id="new-booth-description"
              value={description}
              maxLength={500}
              disabled={busy}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-24 rounded-md border border-border bg-background px-3 py-2 text-base text-foreground"
            />
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-medium text-foreground">Items</h3>
              <Button
                type="button"
                variant="outline"
                disabled={busy || items.length >= MAX_BOOTH_ITEMS}
                onClick={() => setItems((current) => [...current, { ...EMPTY_ITEM }])}
              >
                Add item
              </Button>
            </div>
            <ul className="flex flex-col gap-3">
              {items.map((item, index) => {
                const invalidPrice =
                  item.price.trim().length > 0 && parseDollars(item.price) === null;
                return (
                  <li
                    key={index}
                    className="flex flex-col gap-2 rounded-md border border-border p-3"
                  >
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={`new-booth-item-name-${index}`}
                        className="text-sm font-medium text-foreground"
                      >
                        Item name {index + 1}
                      </label>
                      <input
                        id={`new-booth-item-name-${index}`}
                        type="text"
                        value={item.name}
                        maxLength={60}
                        disabled={busy}
                        onChange={(event) => updateItem(index, { name: event.target.value })}
                        className="h-11 rounded-md border border-border bg-background px-3 text-base text-foreground"
                      />
                    </div>
                    <div className="flex items-end gap-3">
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <label
                          htmlFor={`new-booth-item-price-${index}`}
                          className="text-sm font-medium text-foreground"
                        >
                          Price in dollars
                        </label>
                        <input
                          id={`new-booth-item-price-${index}`}
                          type="text"
                          inputMode="decimal"
                          value={item.price}
                          disabled={busy}
                          aria-invalid={invalidPrice}
                          onChange={(event) => updateItem(index, { price: event.target.value })}
                          className={`h-11 rounded-md border bg-background px-3 text-base text-foreground ${
                            invalidPrice ? "border-danger" : "border-border"
                          }`}
                        />
                      </div>
                      {items.length > 1 ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          aria-label={`Remove item ${index + 1}`}
                          onClick={() =>
                            setItems((current) => current.filter((_, i) => i !== index))
                          }
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? "Creating…" : "Create booth"}
            </Button>
            <Button type="button" variant="outline" size="lg" disabled={busy} onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
