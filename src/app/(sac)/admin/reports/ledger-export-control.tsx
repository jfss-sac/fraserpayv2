"use client";

import { useState } from "react";
import { LEDGER_EXPORT_ROW_LIMIT } from "@/lib/shared/constants";

function localInputValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function LedgerExportControl() {
  const now = new Date();
  const [from, setFrom] = useState(localInputValue(new Date(now.getTime() - 24 * 60 * 60_000)));
  const [to, setTo] = useState(localInputValue(now));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function download(): Promise<void> {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) {
      setMessage("Choose both ends of the export range.");
      return;
    }
    if (fromDate >= toDate) {
      setMessage("The export range must end after it starts.");
      return;
    }

    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/exec/ledger/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: fromDate.toISOString(), to: toDate.toISOString() }),
      });
      if (!response.ok) {
        setMessage("Couldn’t download the ledger export. Try again.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        "ledger.csv";
      link.click();
      URL.revokeObjectURL(url);
      setMessage(
        response.headers.get("x-export-truncated") === "true"
          ? `Downloaded an incomplete export: the ${LEDGER_EXPORT_ROW_LIMIT.toLocaleString()}-row cap was reached.`
          : "Ledger export downloaded.",
      );
    } catch {
      setMessage("Couldn’t download the ledger export. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div>
        <h2 className="font-semibold text-foreground">Itemized ledger export</h2>
        <p className="text-sm text-muted">
          Exec-only. Choose an instant range; the CSV includes buyer names.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
          From
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
          To
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 font-normal"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void download()}
          disabled={pending}
          className="h-10 rounded-md border border-border px-4 text-sm font-medium text-foreground disabled:opacity-50"
        >
          {pending ? "Preparing…" : "Download itemized CSV"}
        </button>
        {message ? (
          <p role="status" className="text-sm text-muted">
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
