import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getBoothSettings, getSession, isBoothMember } from "@/lib/server/dal";
import { formatCents } from "@/lib/shared/money";
import type { BoothItem, BoothStatus } from "@/lib/shared/types";
import { BoothTabs } from "@/lib/ui/booth-tabs";

export const metadata: Metadata = {
  title: "Booth settings",
};

const STATUS_LABEL: Record<BoothStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  deactivated: "Deactivated",
};

const STATUS_BADGE: Record<BoothStatus, string> = {
  pending: "bg-brand/10 text-brand",
  approved: "bg-success/10 text-success",
  deactivated: "bg-muted/10 text-muted",
};

function ItemPrices({ items }: { items: BoothItem[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-4 py-2">
          <span className="text-foreground">{item.name}</span>
          <span className="font-medium text-foreground">
            {item.isCustom ? `${formatCents(item.priceCents)} × N` : formatCents(item.priceCents)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function BoothSettingsPage({
  params,
}: {
  params: Promise<{ boothId: string }>;
}) {
  const { boothId } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await isBoothMember(boothId, session.uid))) notFound();

  const settings = await getBoothSettings(boothId);
  if (!settings) notFound();

  return (
    <div className="flex flex-col gap-6">
      <BoothTabs boothId={boothId} active="settings" isMember />

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">{settings.name}</h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${STATUS_BADGE[settings.status]}`}
          >
            {STATUS_LABEL[settings.status]}
          </span>
        </div>
        <p className="text-sm text-muted">{settings.description}</p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-foreground">Items &amp; prices</h2>
        <ItemPrices items={settings.items} />
        <p className="text-sm text-muted">Contact a SAC member if changes are needed.</p>
      </div>

      {settings.archivedItems.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-foreground">No longer sold</h2>
          <ItemPrices items={settings.archivedItems} />
          <p className="text-sm text-muted">The price each one last sold for.</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-foreground">Members</h2>
        <ul className="flex flex-col divide-y divide-border">
          {settings.memberNames.map((name, index) => (
            <li key={`${name}-${index}`} className="py-2 text-foreground">
              {name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
