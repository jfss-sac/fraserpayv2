import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/server/dal";
import { StudentSearch } from "./student-search";

export const metadata: Metadata = {
  title: "Students",
};

export default async function StudentsPage() {
  const session = await getSession();
  if (!session || session.suspended || !(session.roles.sacMember || session.roles.sacExec)) {
    notFound();
  }

  return <StudentSearch />;
}
