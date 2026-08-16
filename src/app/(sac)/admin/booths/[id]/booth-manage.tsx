"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/shared/money";
import type { BoothDetail, BoothItem, BoothStatus, BoothSummary } from "@/lib/shared/types";
import { ConfirmDialog } from "@/lib/ui/confirm-dialog";
import { useToast } from "@/lib/ui/toast";
import { Button, buttonVariants } from "@/lib/ui/vendor/button";
import {
  approveBooth,
  boothActionErrorMessage,
  editPrices,
  removeMember,
  rotateCode,
  setActive,
  type PriceEdit,
} from "../api";
import { PriceEditor } from "./price-editor";

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

type Dialog =
  | { kind: "rotate" }
  | { kind: "removeMember"; uid: string; name: string }
  | { kind: "deactivate" }
  | { kind: "reactivate" };

function priceSignature(items: BoothItem[]): string {
  return items.map((item) => `${item.id}:${item.priceCents}`).join("|");
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function ReadOnlyItems({ items }: { items: BoothItem[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-4 py-3">
          <span className="font-medium text-foreground">
            {item.name}
            {item.isCustom ? <span className="text-muted"> · price locked</span> : null}
          </span>
          <span className="text-base text-foreground">{formatCents(item.priceCents)}</span>
        </li>
      ))}
    </ul>
  );
}

function SalesCard({ summary }: { summary: BoothSummary }) {
  return (
    <Card title="Sales">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted">Gross</span>
          <span className="text-2xl font-bold text-foreground">
            {formatCents(summary.grossCents)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted">Purchases</span>
          <span className="text-2xl font-bold text-foreground">{summary.purchaseCount}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted">Refunds</span>
          <span className="text-2xl font-bold text-foreground">{summary.refundCount}</span>
        </div>
      </div>
      {summary.items.length === 0 ? (
        <p className="text-sm text-muted">No sales yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {summary.items.map((item) => (
            <li key={item.itemId} className="flex items-center justify-between gap-4 py-2">
              <span className="text-foreground">
                {item.name} <span className="text-muted">× {item.qty}</span>
              </span>
              <span className="text-foreground">{formatCents(item.revenueCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function BoothManage({ detail, isExec }: { detail: BoothDetail; isExec: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const perform = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      try {
        await action();
        setDialog(null);
        push(success, "success");
        router.refresh();
      } catch (err) {
        setDialog(null);
        push(boothActionErrorMessage(err), "error");
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [push, router],
  );

  const onApprove = useCallback(
    (edits: PriceEdit[]) =>
      perform(() => approveBooth(detail.id, edits), "Booth approved — join code ready."),
    [detail.id, perform],
  );
  const onSavePrices = useCallback(
    (edits: PriceEdit[]) => perform(() => editPrices(detail.id, edits), "Prices updated."),
    [detail.id, perform],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">{detail.name}</h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${STATUS_BADGE[detail.status]}`}
          >
            {STATUS_LABEL[detail.status]}
          </span>
        </div>
        <p className="text-sm text-muted">{detail.description}</p>
      </div>

      {detail.status === "pending" ? (
        <>
          <Card title="Teacher check">
            <p className="text-sm text-muted">
              Confirm this came from a real teacher before approving.
            </p>
            <div className="flex flex-col gap-1 rounded-md border border-border bg-background p-4">
              <span className="text-sm text-muted">Submitted by</span>
              <span className="text-xl font-semibold text-foreground break-all">
                {detail.submitterEmail}
              </span>
            </div>
          </Card>

          <Card title="Items & prices">
            {isExec ? (
              <PriceEditor
                key={priceSignature(detail.items)}
                items={detail.items}
                submitLabel="Approve booth"
                busy={busy}
                allowNoChange
                onSubmit={onApprove}
              />
            ) : (
              <>
                <ReadOnlyItems items={detail.items} />
                <p className="text-sm text-muted">Only execs can approve booths.</p>
              </>
            )}
          </Card>
        </>
      ) : (
        <>
          <Card title="Join code">
            <p className="text-sm text-muted">
              Email this code to the teacher; each seller enters it once to join.
            </p>
            <p className="font-mono text-3xl font-bold tracking-wide text-foreground">
              {detail.joinCode}
            </p>
            {isExec ? (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialog({ kind: "rotate" })}
                >
                  Rotate code
                </Button>
              </div>
            ) : null}
          </Card>

          {isExec && detail.status === "approved" ? (
            <Card title="Point of sale">
              <p className="text-sm text-muted">
                Sell for this booth when nobody from it is at the counter. The sale is recorded
                under your name and logged for review.
              </p>
              <div>
                <Link
                  href={`/sell/${detail.id}`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  Sell for this booth
                </Link>
              </div>
            </Card>
          ) : null}

          <Card title="Items & prices">
            {isExec ? (
              <PriceEditor
                key={priceSignature(detail.items)}
                items={detail.items}
                submitLabel="Save prices"
                busy={busy}
                allowNoChange={false}
                onSubmit={onSavePrices}
              />
            ) : (
              <ReadOnlyItems items={detail.items} />
            )}
          </Card>

          <Card title="Members">
            {detail.members.length === 0 ? (
              <p className="text-sm text-muted">No sellers have joined yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {detail.members.map((member) => (
                  <li key={member.uid} className="flex items-center justify-between gap-4 py-3">
                    <span className="font-medium text-foreground">{member.displayName}</span>
                    {isExec ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          setDialog({
                            kind: "removeMember",
                            uid: member.uid,
                            name: member.displayName,
                          })
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {detail.summary ? <SalesCard summary={detail.summary} /> : null}

          {isExec ? (
            <Card title={detail.status === "approved" ? "Deactivate booth" : "Reactivate booth"}>
              {detail.status === "approved" ? (
                <>
                  <p className="text-sm text-muted">
                    A deactivated booth cannot sell or accept new members until reactivated.
                  </p>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDialog({ kind: "deactivate" })}
                    >
                      Deactivate
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted">
                    Reactivating lets this booth sell again with its existing join code.
                  </p>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDialog({ kind: "reactivate" })}
                    >
                      Reactivate
                    </Button>
                  </div>
                </>
              )}
            </Card>
          ) : null}
        </>
      )}

      {dialog?.kind === "rotate" ? (
        <ConfirmDialog
          title="Rotate join code?"
          confirmLabel="Rotate code"
          danger
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => perform(() => rotateCode(detail.id), "Join code rotated.")}
        >
          <p>
            The current code stops working immediately. Anyone mid-join must use the new code. Email
            the new code to the teacher.
          </p>
        </ConfirmDialog>
      ) : null}

      {dialog?.kind === "removeMember" ? (
        <ConfirmDialog
          title="Remove member?"
          confirmLabel="Remove"
          danger
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => perform(() => removeMember(detail.id, dialog.uid), "Member removed.")}
        >
          <p>{dialog.name} can no longer sell for this booth until they rejoin with the code.</p>
        </ConfirmDialog>
      ) : null}

      {dialog?.kind === "deactivate" ? (
        <ConfirmDialog
          title="Deactivate booth?"
          confirmLabel="Deactivate"
          danger
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => perform(() => setActive(detail.id, false), "Booth deactivated.")}
        >
          <p>{detail.name} stops selling and cannot accept new members until reactivated.</p>
        </ConfirmDialog>
      ) : null}

      {dialog?.kind === "reactivate" ? (
        <ConfirmDialog
          title="Reactivate booth?"
          confirmLabel="Reactivate"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => perform(() => setActive(detail.id, true), "Booth reactivated.")}
        >
          <p>{detail.name} can sell again immediately with its existing join code.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
