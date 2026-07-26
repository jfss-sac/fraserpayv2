import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/server/dal";
import { TopUpForm } from "./topup-form";

export const metadata: Metadata = {
  title: "Top-up",
};

export default async function TopUpPage() {
  const session = await getSession();
  if (!session || session.suspended || !(session.roles.sacMember || session.roles.sacExec)) {
    notFound();
  }

  return <TopUpForm isExec={session.roles.sacExec} />;
}
