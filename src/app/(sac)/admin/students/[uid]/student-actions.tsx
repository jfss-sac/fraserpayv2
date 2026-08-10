"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TIMEZONE } from "@/lib/shared/constants";
import { formatCents } from "@/lib/shared/money";
import type { SacLedgerEntry, SacRoles, StudentDetail } from "@/lib/shared/types";
import { ConfirmDialog } from "@/lib/ui/confirm-dialog";
import { Toaster, useToasts } from "@/lib/ui/toast";
import { useIdempotencyKey } from "@/lib/ui/use-idempotency-key";
import { Button } from "@/lib/ui/vendor/button";
import {
  adjustErrorMessage,
  adminActionErrorMessage,
  execAdjust,
  execRefund,
  execRegenPaymentCode,
  execRoles,
  execSuspend,
  refundErrorMessage,
} from "./actions-api";
import { AdjustDialog, type LinkableTopUp } from "./adjust-dialog";
import { RefundDialog } from "./refund-dialog";
import { StudentLedger } from "./student-ledger";

const TOPUP_LABEL_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  month: "short",
  day: "numeric",
});

type Dialog =
  | { kind: "adjust" }
  | { kind: "refund"; entry: SacLedgerEntry }
  | { kind: "regen" }
  | { kind: "suspend" }
  | { kind: "role"; role: keyof SacRoles; grant: boolean };

function linkableTopUps(entries: SacLedgerEntry[]): LinkableTopUp[] {
  return entries
    .filter((entry) => entry.type === "topup")
    .map((entry) => ({
      id: entry.id,
      label: `${TOPUP_LABEL_FORMAT.format(new Date(entry.createdAt))} · ${formatCents(
        entry.amountCents,
      )}${entry.method ? ` (${entry.method})` : ""}`,
    }));
}

function RoleRow({
  label,
  held,
  disabled,
  onGrant,
  onRevoke,
}: {
  label: string;
  held: boolean;
  disabled: boolean;
  onGrant: () => void;
  onRevoke: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground">
        {label} · <span className="text-muted">{held ? "granted" : "not granted"}</span>
      </span>
      {held ? (
        <Button type="button" variant="outline" disabled={disabled} onClick={onRevoke}>
          Revoke
        </Button>
      ) : (
        <Button type="button" variant="outline" disabled={disabled} onClick={onGrant}>
          Grant
        </Button>
      )}
    </div>
  );
}

export function StudentActions({
  student,
  viewerUid,
  isExec,
  initialEntries,
  initialCursor,
}: {
  student: StudentDetail;
  viewerUid: string;
  isExec: boolean;
  initialEntries: SacLedgerEntry[];
  initialCursor: string | null;
}) {
  const router = useRouter();
  const { toasts, push, dismiss } = useToasts();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const { keyFor, release } = useIdempotencyKey();

  const perform = useCallback(
    async <T,>(
      action: () => Promise<T>,
      success: string,
      errorMessage: (err: unknown) => string,
    ) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      try {
        await action();
        setDialog(null);
        push(success, "success");
        router.refresh();
      } catch (err) {
        push(errorMessage(err), "error");
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [push, router],
  );

  const onRefund = useCallback((entry: SacLedgerEntry) => setDialog({ kind: "refund", entry }), []);

  const suspendRevokesSelf = student.uid === viewerUid;

  return (
    <>
      {isExec ? (
        <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-lg font-semibold text-foreground">Exec actions</h2>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setDialog({ kind: "adjust" })}>
              Adjust balance
            </Button>
            <Button type="button" variant="outline" onClick={() => setDialog({ kind: "regen" })}>
              Regenerate payment code
            </Button>
            <Button type="button" variant="outline" onClick={() => setDialog({ kind: "suspend" })}>
              {student.suspended ? "Unsuspend account" : "Suspend account"}
            </Button>
          </div>
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <h3 className="text-sm font-medium text-foreground">Roles</h3>
            <RoleRow
              label="SAC member"
              held={student.roles.sacMember}
              disabled={busy}
              onGrant={() => setDialog({ kind: "role", role: "sacMember", grant: true })}
              onRevoke={() => setDialog({ kind: "role", role: "sacMember", grant: false })}
            />
            <RoleRow
              label="SAC exec"
              held={student.roles.sacExec}
              disabled={busy}
              onGrant={() => setDialog({ kind: "role", role: "sacExec", grant: true })}
              onRevoke={() => setDialog({ kind: "role", role: "sacExec", grant: false })}
            />
          </div>
        </section>
      ) : null}

      <StudentLedger
        key={initialEntries[0]?.id ?? "empty"}
        studentUid={student.uid}
        initialEntries={initialEntries}
        initialCursor={initialCursor}
        {...(isExec ? { onRefund } : {})}
      />

      {dialog?.kind === "adjust" ? (
        <AdjustDialog
          studentName={student.displayName}
          currentPoints={student.points}
          topups={linkableTopUps(initialEntries)}
          busy={busy}
          onCancel={() => setDialog(null)}
          onSubmit={(input) => {
            const body = { studentUid: student.uid, ...input };
            return perform(
              async () => {
                const result = await execAdjust(body, keyFor("/api/exec/adjust", body));
                release("/api/exec/adjust", body);
                return result;
              },
              "Balance adjusted.",
              adjustErrorMessage,
            );
          }}
        />
      ) : null}

      {dialog?.kind === "refund" ? (
        <RefundDialog
          entry={dialog.entry}
          busy={busy}
          onCancel={() => setDialog(null)}
          onSubmit={(input) =>
            perform(
              async () => {
                const result = await execRefund(input, keyFor("/api/exec/refund", input));
                release("/api/exec/refund", input);
                return result;
              },
              "Refund issued.",
              refundErrorMessage,
            )
          }
        />
      ) : null}

      {dialog?.kind === "regen" ? (
        <ConfirmDialog
          title="Regenerate payment code?"
          confirmLabel="Regenerate code"
          danger
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            perform(
              () => execRegenPaymentCode(student.uid),
              "Payment code regenerated.",
              adminActionErrorMessage,
            )
          }
        >
          <p>
            {student.displayName}&rsquo;s current payment code stops working immediately. They will
            see the new code in their wallet.
          </p>
        </ConfirmDialog>
      ) : null}

      {dialog?.kind === "suspend" ? (
        <ConfirmDialog
          title={student.suspended ? "Unsuspend account?" : "Suspend account?"}
          confirmLabel={student.suspended ? "Unsuspend" : "Suspend"}
          danger={!student.suspended}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            perform(
              () => execSuspend(student.uid, !student.suspended),
              student.suspended ? "Account unsuspended." : "Account suspended.",
              adminActionErrorMessage,
            )
          }
        >
          {student.suspended ? (
            <p>{student.displayName} can be topped up, charged, and sell again.</p>
          ) : (
            <p>
              {student.displayName} is blocked from being topped up or charged, selling, and all
              admin actions until unsuspended.
            </p>
          )}
        </ConfirmDialog>
      ) : null}

      {dialog?.kind === "role" ? (
        <ConfirmDialog
          title={`${dialog.grant ? "Grant" : "Revoke"} ${
            dialog.role === "sacExec" ? "SAC exec" : "SAC member"
          }?`}
          confirmLabel={dialog.grant ? "Grant" : "Revoke"}
          danger={!dialog.grant}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            perform(
              () => execRoles(student.uid, dialog.role, dialog.grant),
              dialog.grant ? "Role granted." : "Role revoked.",
              adminActionErrorMessage,
            )
          }
        >
          {!dialog.grant && dialog.role === "sacExec" && suspendRevokesSelf ? (
            <p>
              This revokes your own exec access. It is blocked if you are the last exec — grant
              another exec first.
            </p>
          ) : (
            <p>
              {dialog.grant ? "Grant" : "Revoke"} {student.displayName}
              {dialog.grant ? " " : "'s "}
              {dialog.role === "sacExec" ? "SAC exec" : "SAC member"} access?
            </p>
          )}
        </ConfirmDialog>
      ) : null}

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
