export interface AdminNavItem {
  href: string;
  label: string;
  exec?: boolean;
}

export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: "/admin", label: "Feed" },
  { href: "/admin/topup", label: "Top-up" },
  { href: "/admin/students", label: "Students" },
  { href: "/admin/booths", label: "Booths" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/reconciliation", label: "Reconciliation" },
  { href: "/admin/activity", label: "Activity" },
];

export function visibleNav(
  items: readonly AdminNavItem[],
  roles: { sacMember: boolean; sacExec: boolean },
): AdminNavItem[] {
  return items.filter((item) => !item.exec || roles.sacExec);
}
