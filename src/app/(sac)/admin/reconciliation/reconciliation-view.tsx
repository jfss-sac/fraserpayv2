"use client";

import { useEffect, useRef, useState } from "react";
import { TIMEZONE } from "@/lib/shared/constants";
import { formatCents } from "@/lib/shared/money";
import type {
  ReconCorrectionEntry,
  ReconMemberTotals,
  ReconTopupEntry,
  ReconciliationDTO,
} from "@/lib/shared/types";
import { ReconciliationApiError, reconciliationErrorMessage, requestReconciliation } from "./api";

const DEBOUNCE_MS = 150;

type ViewState =
  | { status: "loading" }
  | { status: "loaded"; data: ReconciliationDTO }
  | { status: "error"; message: string };

const TIME_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function timeOf(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}

function studentLabel(name: string, number: string | null): string {
  return number ? `${name} · #${number}` : name;
}

function TopupRow({ entry }: { entry: ReconTopupEntry }) {
  const override = entry.tags.includes("cap-override");
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="flex flex-col">
        <span className="text-foreground">
          {studentLabel(entry.studentName, entry.studentNumber)}
        </span>
        <span className="text-xs text-muted">
          {timeOf(entry.createdAt)} · {entry.method}
          {override ? " · override" : ""}
        </span>
      </span>
      <span className="font-medium text-foreground">{formatCents(entry.amountCents)}</span>
    </li>
  );
}

function CorrectionRow({ entry }: { entry: ReconCorrectionEntry }) {
  const signed = entry.direction === "credit" ? entry.amountCents : -entry.amountCents;
  return (
    <li className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="flex flex-col">
        <span className="text-foreground">
          {studentLabel(entry.studentName, entry.studentNumber)}
        </span>
        {entry.reason ? <span className="text-xs text-muted">{entry.reason}</span> : null}
      </span>
      <span className="font-medium text-foreground">{formatCents(signed)}</span>
    </li>
  );
}

function MemberCard({ member, isYou }: { member: ReconMemberTotals; isYou: boolean }) {
  const [open, setOpen] = useState(false);
  const total = member.cashCents + member.cardCents;
  const detailId = `recon-detail-${member.actorUid}`;
  const subject = isYou ? "You recorded" : `${member.actorName} recorded`;

  return (
    <li className="rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
      >
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2 font-medium text-foreground">
            {member.actorName}
            {isYou ? (
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                You
              </span>
            ) : null}
          </span>
          <span className="text-sm text-muted">
            {subject} {formatCents(member.cashCents)} cash / {formatCents(member.cardCents)} card
          </span>
        </span>
        <span className="text-right">
          <span className="block font-semibold text-foreground">{formatCents(total)}</span>
          <span className="block text-xs text-muted">{member.topups.length} top-ups</span>
        </span>
      </button>

      {open ? (
        <div id={detailId} className="border-t border-border px-4 py-3">
          <ul className="divide-y divide-border">
            {member.topups.map((e) => (
              <TopupRow key={e.id} entry={e} />
            ))}
          </ul>
          {member.corrections.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Corrections
              </p>
              <ul className="divide-y divide-border">
                {member.corrections.map((e) => (
                  <CorrectionRow key={e.id} entry={e} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function ReconciliationView({
  initialDate,
  currentUid,
}: {
  initialDate: string;
  currentUid: string;
}) {
  const [date, setDate] = useState(initialDate);
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const seq = useRef(0);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const id = seq.current + 1;
    seq.current = id;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState({ status: "loading" });
      requestReconciliation(date, controller.signal)
        .then((data) => {
          if (seq.current === id) setState({ status: "loaded", data });
        })
        .catch((err) => {
          if (controller.signal.aborted || seq.current !== id) return;
          const code = err instanceof ReconciliationApiError ? err.code : "NETWORK";
          setState({ status: "error", message: reconciliationErrorMessage(code) });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [date]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-foreground">Reconciliation</h1>

      <div className="flex flex-col gap-2">
        <label htmlFor="recon-date" className="text-sm font-medium text-foreground">
          Day (America/Toronto)
        </label>
        <input
          id="recon-date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="h-12 w-full max-w-xs rounded-md border border-border bg-background px-4 text-base text-foreground"
        />
        <p className="text-sm text-muted">
          Totals cover top-ups recorded on this calendar day. Check them against the cash box and
          the terminal batch.
        </p>
      </div>

      <div aria-live="polite">
        {state.status === "loading" ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : state.status === "error" ? (
          <p role="status" className="text-sm font-medium text-danger">
            {state.message}
          </p>
        ) : state.data.members.length === 0 ? (
          <p className="text-sm text-muted">No top-ups recorded on this day.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border px-4 py-3">
                <dt className="text-sm text-muted">Cash</dt>
                <dd className="text-lg font-semibold text-foreground">
                  {formatCents(state.data.totals.cashCents)}
                </dd>
              </div>
              <div className="rounded-lg border border-border px-4 py-3">
                <dt className="text-sm text-muted">Card</dt>
                <dd className="text-lg font-semibold text-foreground">
                  {formatCents(state.data.totals.cardCents)}
                </dd>
              </div>
              <div className="rounded-lg border border-border px-4 py-3">
                <dt className="text-sm text-muted">Top-ups</dt>
                <dd className="text-lg font-semibold text-foreground">
                  {state.data.totals.topupCount}
                </dd>
              </div>
            </dl>

            <ul className="flex flex-col gap-3">
              {state.data.members.map((member) => (
                <MemberCard
                  key={member.actorUid}
                  member={member}
                  isYou={member.actorUid === currentUid}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
