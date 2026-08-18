import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/dal";
import { type LedgerEntryDoc, ledgerCol } from "@/lib/server/db";
import { renderPaymentQrSvg } from "@/lib/server/qr";
import { IOS_INSTALL_HINT_SCRIPT } from "./install-hint-script";
import { WALLET_REFRESH_SCRIPT } from "./refresh-script";
import { WalletView, type WalletHistoryItem } from "./wallet-view";

export const metadata: Metadata = {
  title: "Wallet",
};

const HISTORY_LIMIT = 20;

function toHistoryItem(id: string, doc: LedgerEntryDoc): WalletHistoryItem {
  return {
    id,
    type: doc.type,
    direction: doc.direction,
    amountCents: doc.amountCents,
    balanceAfterCents: doc.balanceAfterCents,
    createdAtIso: doc.createdAt.toDate().toISOString(),
    ...(doc.boothName !== undefined ? { boothName: doc.boothName } : {}),
    ...(doc.method !== undefined ? { method: doc.method } : {}),
    ...(doc.lineItems !== undefined ? { lineItems: doc.lineItems } : {}),
    ...(doc.reason !== undefined ? { reason: doc.reason } : {}),
  };
}

export default async function WalletPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const ledgerSnap = await ledgerCol()
    .where("studentUid", "==", session.uid)
    .orderBy("createdAt", "desc")
    .limit(HISTORY_LIMIT)
    .get();

  const qrSvg = renderPaymentQrSvg(session.paymentCode);
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <>
      <WalletView
        qrSvg={qrSvg}
        paymentCode={session.paymentCode}
        studentNumber={session.studentNumber}
        balanceCents={session.balanceCents}
        points={session.points}
        asOfIso={new Date().toISOString()}
        history={ledgerSnap.docs.map((doc) => toHistoryItem(doc.id, doc.data()))}
      />
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: IOS_INSTALL_HINT_SCRIPT }} />
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: WALLET_REFRESH_SCRIPT }} />
    </>
  );
}
