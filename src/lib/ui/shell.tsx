import Link from "next/link";
import { SignOutButton } from "./sign-out-button";

export type Mode = "student" | "sell" | "admin";

const MODE_META: Record<Mode, { href: string; label: string }> = {
  student: { href: "/wallet", label: "Wallet" },
  sell: { href: "/sell", label: "Sell" },
  admin: { href: "/admin", label: "Admin" },
};

export function buildModes(
  roles: { sacMember: boolean; sacExec: boolean },
  hasBooth: boolean,
): Mode[] {
  const modes: Mode[] = ["student"];
  if (hasBooth) modes.push("sell");
  if (roles.sacMember || roles.sacExec) modes.push("admin");
  return modes;
}

export function AppShell({
  active,
  modes,
  suspended,
  children,
}: {
  active: Mode;
  modes: Mode[];
  suspended: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 p-4">
          <nav aria-label="Mode" className="flex items-center gap-1">
            {modes.map((mode) => {
              const meta = MODE_META[mode];
              const isActive = mode === active;
              return (
                <Link
                  key={mode}
                  href={meta.href}
                  aria-current={isActive ? "page" : undefined}
                  className={
                    isActive
                      ? "rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground"
                      : "rounded-md px-3 py-1.5 text-sm font-medium text-muted"
                  }
                >
                  {meta.label}
                </Link>
              );
            })}
          </nav>
          <SignOutButton />
        </div>
      </header>
      {suspended ? (
        <div
          role="alert"
          className="border-b border-border bg-surface px-4 py-3 text-center text-sm font-medium text-danger"
        >
          This account is suspended — see SAC.
        </div>
      ) : null}
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">{children}</main>
    </div>
  );
}
