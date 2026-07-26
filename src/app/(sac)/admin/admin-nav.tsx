"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui/vendor/utils";
import type { AdminNavItem } from "./nav";

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav({ items }: { items: readonly AdminNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Admin sections"
      className="-mx-1 flex flex-wrap gap-1 border-b border-border pb-3"
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              active ? "bg-brand text-brand-foreground" : "text-muted hover:bg-surface",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
