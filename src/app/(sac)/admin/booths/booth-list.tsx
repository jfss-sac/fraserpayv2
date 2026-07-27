"use client";

import Link from "next/link";
import { useState } from "react";
import type { AdminBoothListItem, BoothStatus } from "@/lib/shared/types";

type Filter = "all" | BoothStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "deactivated", label: "Deactivated" },
];

const STATUS_BADGE: Record<BoothStatus, string> = {
  pending: "bg-brand/10 text-brand",
  approved: "bg-success/10 text-success",
  deactivated: "bg-muted/10 text-muted",
};

const STATUS_LABEL: Record<BoothStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  deactivated: "Deactivated",
};

function BoothRow({ booth }: { booth: AdminBoothListItem }) {
  return (
    <li>
      <Link
        href={`/admin/booths/${booth.id}`}
        className="flex items-center justify-between gap-4 rounded-md px-3 py-3 hover:bg-surface"
      >
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{booth.name}</span>
          {booth.status === "pending" ? (
            <span className="text-sm text-muted">Submitted by {booth.submitterEmail}</span>
          ) : booth.joinCode ? (
            <span className="text-sm font-mono text-muted">{booth.joinCode}</span>
          ) : null}
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${STATUS_BADGE[booth.status]}`}
        >
          {STATUS_LABEL[booth.status]}
        </span>
      </Link>
    </li>
  );
}

export function BoothList({ booths }: { booths: AdminBoothListItem[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const pendingCount = booths.filter((booth) => booth.status === "pending").length;
  const shown = filter === "all" ? booths : booths.filter((booth) => booth.status === filter);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Booths</h1>
        {pendingCount > 0 ? (
          <p className="text-sm font-medium text-brand">
            {pendingCount} booth{pendingCount === 1 ? "" : "s"} awaiting review
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter booths by status">
        {FILTERS.map((option) => {
          const active = filter === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(option.key)}
              className={`h-9 rounded-full px-4 text-sm font-medium ${
                active
                  ? "bg-brand text-brand-foreground"
                  : "border border-border bg-background text-foreground hover:bg-surface"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted">No booths in this view.</p>
      ) : (
        <ul className="-mx-3 flex flex-col divide-y divide-border">
          {shown.map((booth) => (
            <BoothRow key={booth.id} booth={booth} />
          ))}
        </ul>
      )}
    </div>
  );
}
