import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/dal";
import { SITE_NAME } from "@/lib/server/site";
import { SignOutButton } from "@/lib/ui/sign-out-button";
import { BoothRegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Request a booth",
};

export default async function RequestBoothPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 p-4">
          <Link href="/wallet" className="font-semibold text-foreground">
            {SITE_NAME}
          </Link>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold text-foreground">Request a booth</h1>
            <p className="text-sm text-foreground">
              Submit your booth and item prices. SAC reviews every request before it can sell.
            </p>
          </div>
          <BoothRegisterForm actorUid={session.uid} />
        </div>
      </main>
    </div>
  );
}
