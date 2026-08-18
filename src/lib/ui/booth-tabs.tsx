import Link from "next/link";
import { cn } from "./vendor/utils";

export type BoothTab = "dashboard" | "sell" | "history" | "settings";

const TABS: readonly { tab: BoothTab; label: string; path: (boothId: string) => string }[] = [
  { tab: "dashboard", label: "Dashboard", path: (id) => `/booth/${id}` },
  { tab: "sell", label: "Sell", path: (id) => `/sell/${id}` },
  { tab: "history", label: "History", path: (id) => `/booth/${id}/history` },
  { tab: "settings", label: "Settings", path: (id) => `/booth/${id}/settings` },
];

export function BoothTabs({
  boothId,
  active,
  isMember,
}: {
  boothId: string;
  active: BoothTab;
  isMember: boolean;
}) {
  return (
    <nav
      aria-label="Booth sections"
      className="-mx-1 flex flex-wrap items-center gap-1 border-b border-border pb-3"
    >
      {isMember ? null : (
        <Link
          href={`/admin/booths/${boothId}`}
          prefetch={false}
          className="inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-sm font-medium text-muted hover:bg-surface"
        >
          <span aria-hidden>←</span>
          Booth admin
        </Link>
      )}
      {TABS.filter((item) => isMember || item.tab === "sell").map((item) => {
        const current = item.tab === active;
        return (
          <Link
            key={item.tab}
            href={item.path(boothId)}
            prefetch={false}
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium",
              current ? "bg-brand text-brand-foreground" : "text-muted hover:bg-surface",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
