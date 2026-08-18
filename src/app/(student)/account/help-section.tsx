import { ERROR_CODES, type ErrorCode } from "@/lib/server/errors";

type StudentVisibleErrorCode = ErrorCode | "NETWORK";

export const STUDENT_VISIBLE_ERROR_CODES = [...ERROR_CODES, "NETWORK"] as const;

export const STUDENT_FAILURE_GUIDANCE = {
  VALIDATION: {
    title: "The cart needs to be rebuilt",
    body: "The cart details were invalid. Ask the operator to rebuild the cart and try again.",
  },
  UNAUTHORIZED: {
    title: "The sign-in session expired",
    body: "Sign in again before trying another charge. If you are unsure whether it went through, check your wallet first.",
  },
  FORBIDDEN: {
    title: "The booth cannot charge this account",
    body: "Ask an SAC member for help with the booth access.",
  },
  SUSPENDED: {
    title: "The account is suspended",
    body: "Ask SAC to review the account before trying again.",
  },
  NOT_FOUND: {
    title: "The booth could not find the account",
    body: "Ask the operator to scan or enter the payment code again.",
  },
  INSUFFICIENT_FUNDS: {
    title: "The balance cannot cover the cart",
    body: "Add funds at the SAC table, then ask the booth to try again.",
  },
  CAP_EXCEEDED: {
    title: "The top-up cap was reached",
    body: "Ask SAC about the $100 top-up cap and $200 balance cap.",
  },
  IDEMPOTENCY_CONFLICT: {
    title: "The charge may still be going through",
    body: "Check your wallet or ask SAC before trying the charge again.",
  },
  RATE_LIMITED: {
    title: "Too many charges were attempted",
    body: "Wait a moment, then try again.",
  },
  BOOTH_NOT_SELLABLE: {
    title: "This booth cannot sell right now",
    body: "Try another booth or ask SAC for help.",
  },
  CATALOG_CHANGED: {
    title: "The booth's prices changed",
    body: "Ask the operator to refresh the menu and confirm the new total.",
  },
  CONFLICT: {
    title: "Something changed while the charge was processing",
    body: "Check your wallet and ask SAC before trying again.",
  },
  INTERNAL: {
    title: "FraserPay could not complete the charge",
    body: "Check your connection and ask SAC if the problem continues.",
  },
  NETWORK: {
    title: "The booth is offline",
    body: "Charging is paused. Wait for the booth to reconnect, then try again; your cart is safe.",
  },
} satisfies Record<StudentVisibleErrorCode, { title: string; body: string }>;

export function HelpSection({ externalHelpUrl }: { externalHelpUrl?: string }) {
  return (
    <section aria-labelledby="help-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id="help-heading" className="text-lg font-semibold text-foreground">
          Help &amp; support
        </h2>
        <p className="text-sm text-muted">Quick answers for adding funds and paying at a booth.</p>
      </div>

      <section aria-labelledby="add-funds-heading" className="flex flex-col gap-2">
        <h3 id="add-funds-heading" className="font-semibold text-foreground">
          How to add funds
        </h3>
        <p className="text-sm text-foreground">
          Bring cash or a debit or credit card to the SAC table. Add amounts in $0.50 increments;
          each top-up can be up to $100, and your balance can be up to $200.
        </p>
      </section>

      <section aria-labelledby="charge-help-heading" className="flex flex-col gap-3">
        <h3 id="charge-help-heading" className="font-semibold text-foreground">
          What to do if a charge fails
        </h3>
        <ul className="flex flex-col gap-2">
          {STUDENT_VISIBLE_ERROR_CODES.map((code) => {
            const guidance = STUDENT_FAILURE_GUIDANCE[code];
            return (
              <li
                key={code}
                data-testid={`charge-help-${code}`}
                className="rounded-lg border border-border bg-surface px-4 py-3"
              >
                <p className="font-medium text-foreground">{guidance.title}</p>
                <p className="mt-1 text-sm text-muted">{guidance.body}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="payment-code-heading" className="flex flex-col gap-2">
        <h3 id="payment-code-heading" className="font-semibold text-foreground">
          What your payment code is for
        </h3>
        <p className="text-sm text-foreground">
          Booths use your payment code to identify your wallet when you buy. It does not show your
          account details, but anyone with the code who is an approved booth member can charge your
          balance.
        </p>
        <p className="text-sm text-foreground">
          If you think the code leaked, ask an SAC exec to regenerate it. Tell SAC about any charge
          you do not recognize so it can be reviewed and refunded if needed.
        </p>
      </section>

      <section aria-labelledby="support-heading" className="flex flex-col gap-2">
        <h3 id="support-heading" className="font-semibold text-foreground">
          Need support?
        </h3>
        <p className="text-sm text-foreground">Find the SAC table or ask any SAC member.</p>
        {externalHelpUrl ? (
          <a
            href={externalHelpUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-brand underline underline-offset-2"
          >
            Open the school how-to
          </a>
        ) : null}
      </section>
    </section>
  );
}
