import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/dal";
import { type LedgerEntryDoc, ledgerCol, usersCol } from "@/lib/server/db";
import { renderPaymentQrSvg } from "@/lib/server/qr";
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

  const [userSnap, ledgerSnap] = await Promise.all([
    usersCol().doc(session.uid).get(),
    ledgerCol()
      .where("studentUid", "==", session.uid)
      .orderBy("createdAt", "desc")
      .limit(HISTORY_LIMIT)
      .get(),
  ]);

  const user = userSnap.data();
  if (!user) redirect("/login");

  const qrSvg = renderPaymentQrSvg(user.paymentCode);

  return (
    <WalletView
      qrSvg={qrSvg}
      studentNumber={user.studentNumber}
      balanceCents={user.balanceCents}
      points={user.points}
      asOfIso={new Date().toISOString()}
      history={ledgerSnap.docs.map((doc) => toHistoryItem(doc.id, doc.data()))}
    />
  );
}
