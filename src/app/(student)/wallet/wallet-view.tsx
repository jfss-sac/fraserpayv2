import { TIMEZONE } from "@/lib/shared/constants";
import { formatCents } from "@/lib/shared/money";
import type {
  LedgerDirection,
  LedgerLineItem,
  LedgerType,
  PaymentMethod,
} from "@/lib/shared/types";

export interface WalletHistoryItem {
  id: string;
  type: LedgerType;
  direction: LedgerDirection;
  amountCents: number;
  balanceAfterCents: number;
  createdAtIso: string;
  boothName?: string;
  method?: PaymentMethod;
  lineItems?: LedgerLineItem[];
  reason?: string;
}

export interface WalletViewProps {
  qrSvg: string;
  paymentCode: string;
  studentNumber: string | null;
  balanceCents: number;
  points: number;
  asOfIso: string;
  history: WalletHistoryItem[];
}

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

function entryTitle(item: WalletHistoryItem): string {
  switch (item.type) {
    case "purchase":
      return item.boothName ?? "Purchase";
    case "refund":
      return item.boothName ? `Refund · ${item.boothName}` : "Refund";
    case "topup":
      return item.method ? `Top-up · ${item.method === "cash" ? "Cash" : "Card"}` : "Top-up";
    case "adjustment":
      return "Adjustment";
  }
}

function HistoryRow({ item }: { item: WalletHistoryItem }) {
  const credit = item.direction === "credit";
  const amount = credit ? `+${formatCents(item.amountCents)}` : formatCents(-item.amountCents);
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium text-foreground">{entryTitle(item)}</span>
        <span className={credit ? "font-semibold text-success" : "font-semibold text-foreground"}>
          {amount}
        </span>
      </div>
      {item.lineItems && item.lineItems.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-sm text-muted">
          {item.lineItems.map((line, index) => (
            <li key={`${line.itemId}-${index}`} className="flex justify-between gap-4">
              <span>
                {line.name} × {line.qty} @ {formatCents(line.unitPriceCents)}
              </span>
              <span>{formatCents(line.qty * line.unitPriceCents)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {item.reason ? <p className="text-sm text-muted">{item.reason}</p> : null}
      <div className="flex items-baseline justify-between gap-4 text-xs text-muted">
        <time dateTime={item.createdAtIso}>{formatStamp(item.createdAtIso)}</time>
        <span>Balance {formatCents(item.balanceAfterCents)}</span>
      </div>
    </li>
  );
}

export function WalletView({
  qrSvg,
  paymentCode,
  studentNumber,
  balanceCents,
  points,
  asOfIso,
  history,
}: WalletViewProps) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Wallet</h1>
      <aside
        data-ios-install-hint=""
        hidden
        aria-labelledby="ios-install-hint-title"
        className="rounded-lg border border-brand/30 bg-brand/5 p-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="ios-install-hint-title" className="font-semibold text-foreground">
              Install the wallet on your iPhone
            </h2>
            <p className="text-sm text-muted">
              In Safari, tap Share → Add to Home Screen. Your wallet can then open from the home
              screen when the network is unavailable.
            </p>
            <p data-ios-install-blurb="" className="text-xs text-muted">
              SAC reminder: tell students to open FraserPay in Safari, tap Share → Add to Home
              Screen, and use that icon at the event.
            </p>
          </div>
          <button
            type="button"
            data-ios-install-dismiss=""
            className="min-h-11 shrink-0 rounded-md px-3 py-2 text-sm font-medium text-muted underline underline-offset-4"
          >
            Dismiss
          </button>
        </div>
      </aside>
      <section className="flex flex-col items-center gap-3">
        <div
          className="aspect-square w-full max-w-[15rem] rounded-lg border border-border bg-white p-3"
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
        <p className="text-center text-sm text-muted">
          Payment code
          <br />
          <code className="font-mono text-xs tracking-wider text-foreground">{paymentCode}</code>
        </p>
        {studentNumber ? (
          <p className="text-sm text-muted">
            Student <span className="font-medium text-foreground">#{studentNumber}</span>
          </p>
        ) : null}
        <p className="text-center text-xs text-muted">
          If SAC regenerated your payment code, refresh this page to load the new one.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
          <span className="text-sm text-muted">Balance</span>
          <span data-wallet-balance="" className="text-3xl font-bold text-foreground">
            {formatCents(balanceCents)}
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
          <span className="text-sm text-muted">Points</span>
          <span data-wallet-points="" className="text-3xl font-bold text-foreground">
            {points}
          </span>
        </div>
      </section>

      <p
        data-wallet-stamp=""
        data-stale="false"
        className="group text-center text-xs text-muted data-[stale=true]:text-warning"
      >
        As of{" "}
        <time data-wallet-asof="" dateTime={asOfIso}>
          {formatStamp(asOfIso)}
        </time>
        <span className="hidden group-data-[stale=true]:inline"> · may be out of date</span>
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-foreground">Recent transactions</h2>
        <div data-wallet-history="">
          {history.length === 0 ? (
            <p className="text-sm text-muted">No transactions yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {history.map((item) => (
                <HistoryRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
