import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getBoothForSale, getSession, isBoothMember } from "@/lib/server/dal";
import { buttonVariants } from "@/lib/ui/vendor/button";
import { PosCart } from "./pos-cart";

export const metadata: Metadata = {
  title: "Point of sale",
};

export default async function PosPage({ params }: { params: Promise<{ boothId: string }> }) {
  const { boothId } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await isBoothMember(boothId, session.uid))) notFound();

  const booth = await getBoothForSale(boothId);
  if (!booth) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">{booth.name}</h1>
        <Link href="/sell" className={buttonVariants({ variant: "ghost", size: "default" })}>
          Booths
        </Link>
      </div>

      {booth.status === "approved" ? (
        <PosCart items={booth.items} />
      ) : (
        <p role="status" className="text-sm text-muted">
          This booth can&apos;t sell yet. It&apos;s{" "}
          {booth.status === "pending" ? "awaiting SAC approval" : "deactivated"}.
        </p>
      )}
    </div>
  );
}
