import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wallet",
};

export default function WalletPage() {
  return <h1 className="text-2xl font-bold text-foreground">Wallet</h1>;
}
