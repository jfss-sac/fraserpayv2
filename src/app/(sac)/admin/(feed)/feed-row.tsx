"use client";

import { useState } from "react";
import { TIMEZONE } from "@/lib/shared/constants";
import { formatCents } from "@/lib/shared/money";
import type { AuditAction, FeedAuditEntry, FeedEntry, FeedLedgerEntry } from "@/lib/shared/types";

const HIGH_AMOUNT_TAG = "high-amount";

const STAMP_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatStamp(iso: string): string {
  return STAMP_FORMAT.format(new Date(iso));
}

const AUDIT_LABEL: Record<AuditAction, string> = {
  "booth.approve": "Approved booth",
  "booth.priceEdit": "Edited booth prices",
  "booth.itemAdd": "Added booth item",
  "booth.itemArchive": "Archived booth item",
  "booth.itemUnarchive": "Restored booth item",
  "booth.codeRotate": "Rotated join code",
  "booth.memberRemove": "Removed booth member",
  "booth.deactivate": "Deactivated booth",
  "booth.reactivate": "Reactivated booth",
  "user.suspend": "Suspended account",
  "user.unsuspend": "Unsuspended account",
  "user.roleGrant": "Granted role",
  "user.roleRevoke": "Revoked role",
  "user.paymentCodeRegen": "Regenerated payment code",
};

function ledgerTitle(entry: FeedLedgerEntry): string {
  switch (entry.type) {
    case "purchase":
      return entry.boothName ?? "Purchase";
    case "refund":
      return entry.boothName ? `Refund · ${entry.boothName}` : "Refund";
    case "topup":
      return entry.method ? `Top-up · ${entry.method === "cash" ? "Cash" : "Card"}` : "Top-up";
    case "adjustment":
      return "Adjustment";
  }
}

export interface RowActions {
  onFilterBooth: (boothId: string, boothName: string) => void;
  onFilterActor: (actorUid: string, actorName: string) => void;
}

function ActorButton({
  uid,
  name,
  onFilterActor,
}: { uid: string; name: string } & Pick<RowActions, "onFilterActor">) {
  return (
    <button
      type="button"
      onClick={() => onFilterActor(uid, name)}
      className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:text-brand"
    >
      {name}
    </button>
  );
}

function ExpandToggle({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={expanded ? "Hide details" : "Show details"}
      className="shrink-0 rounded-md px-2 py-1 text-sm text-muted hover:bg-surface"
    >
      {expanded ? "▲" : "▼"}
    </button>
  );
}

function LedgerRow({ entry, actions }: { entry: FeedLedgerEntry; actions: RowActions }) {
  const [expanded, setExpanded] = useState(false);
  const credit = entry.direction === "credit";
  const amount = credit ? `+${formatCents(entry.amountCents)}` : formatCents(-entry.amountCents);
  const flagged = entry.tags.includes(HIGH_AMOUNT_TAG);
  const lineItems = entry.lineItems ?? [];

  return (
    <li
      className={
        flagged ? "border-l-4 border-l-warning pl-3" : "border-l-4 border-l-transparent pl-3"
      }
    >
      <div className="flex items-start justify-between gap-3 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="font-medium text-foreground">{ledgerTitle(entry)}</span>
            {flagged ? (
              <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                High amount
              </span>
            ) : null}
          </span>
          <span className="text-sm text-muted">
            {entry.studentName}
            {entry.studentNumber ? ` · #${entry.studentNumber}` : ""}
          </span>
          <span className="flex flex-wrap items-center gap-x-1 text-xs text-muted">
            <time dateTime={entry.createdAt}>{formatStamp(entry.createdAt)}</time>
            <span>· by</span>
            <ActorButton
              uid={entry.actorUid}
              name={entry.actorName}
              onFilterActor={actions.onFilterActor}
            />
            {entry.boothId && entry.boothName ? (
              <>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => actions.onFilterBooth(entry.boothId!, entry.boothName!)}
                  className="underline decoration-dotted underline-offset-2 hover:text-brand"
                >
                  {entry.boothName}
                </button>
              </>
            ) : null}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={credit ? "font-semibold text-success" : "font-semibold text-foreground"}>
            {amount}
          </span>
          <ExpandToggle expanded={expanded} onClick={() => setExpanded((v) => !v)} />
        </div>
      </div>

      {expanded ? (
        <div className="flex flex-col gap-2 pb-3 pl-1 text-sm text-muted">
          {lineItems.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {lineItems.map((line, index) => (
                <li key={`${line.itemId}-${index}`} className="flex justify-between gap-4">
                  <span>
                    {line.name} × {line.qty} @ {formatCents(line.unitPriceCents)}
                  </span>
                  <span>{formatCents(line.qty * line.unitPriceCents)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {entry.reason ? <p>Reason: {entry.reason}</p> : null}
          {entry.pointsDelta !== undefined && entry.pointsDelta !== 0 ? (
            <p>Points {entry.pointsDelta > 0 ? `+${entry.pointsDelta}` : entry.pointsDelta}</p>
          ) : null}
          <p>Balance after · {formatCents(entry.balanceAfterCents)}</p>
        </div>
      ) : null}
    </li>
  );
}

function AuditRow({ entry, actions }: { entry: FeedAuditEntry; actions: RowActions }) {
  const [expanded, setExpanded] = useState(false);
  const details = Object.entries(entry.details);

  return (
    <li className="border-l-4 border-l-border pl-3">
      <div className="flex items-start justify-between gap-3 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="font-medium text-foreground">{AUDIT_LABEL[entry.action]}</span>
            <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted">
              Admin
            </span>
          </span>
          <span className="text-sm text-muted">{entry.targetLabel}</span>
          <span className="flex flex-wrap items-center gap-x-1 text-xs text-muted">
            <time dateTime={entry.createdAt}>{formatStamp(entry.createdAt)}</time>
            <span>· by</span>
            <ActorButton
              uid={entry.actorUid}
              name={entry.actorName}
              onFilterActor={actions.onFilterActor}
            />
          </span>
        </div>
        {details.length > 0 ? (
          <ExpandToggle expanded={expanded} onClick={() => setExpanded((v) => !v)} />
        ) : null}
      </div>

      {expanded && details.length > 0 ? (
        <ul className="flex flex-col gap-0.5 pb-3 pl-1 text-sm text-muted">
          {details.map(([key, value]) => (
            <li key={key} className="flex justify-between gap-4">
              <span>{key}</span>
              <span className="text-foreground">{String(value)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FeedRow({ entry, actions }: { entry: FeedEntry; actions: RowActions }) {
  return entry.kind === "ledger" ? (
    <LedgerRow entry={entry} actions={actions} />
  ) : (
    <AuditRow entry={entry} actions={actions} />
  );
}
