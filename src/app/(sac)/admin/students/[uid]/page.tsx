import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/server/dal";
import { getStudentDetail, getStudentLedger } from "@/lib/server/sac-students";
import { formatCents } from "@/lib/shared/money";
import { StudentLedger } from "./student-ledger";

export const metadata: Metadata = {
  title: "Student",
};

export default async function StudentDetailPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const session = await getSession();
  if (!session || session.suspended || !(session.roles.sacMember || session.roles.sacExec)) {
    notFound();
  }

  const student = await getStudentDetail(uid);
  if (!student) notFound();

  const ledger = await getStudentLedger(uid);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">{student.displayName}</h1>
          {student.suspended ? (
            <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-sm font-medium text-danger">
              Suspended
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted">
          {student.studentNumber ? `Student #${student.studentNumber} · ` : ""}
          {student.email}
        </p>
        <p className="text-sm text-muted">
          Payment code · {student.hasPaymentCode ? "Active" : "Not set"}
        </p>
      </div>

      <section className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
          <span className="text-sm text-muted">Balance</span>
          <span className="text-3xl font-bold text-foreground">
            {formatCents(student.balanceCents)}
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
          <span className="text-sm text-muted">Points</span>
          <span className="text-3xl font-bold text-foreground">{student.points}</span>
        </div>
      </section>

      <StudentLedger
        studentUid={student.uid}
        initialEntries={ledger.entries}
        initialCursor={ledger.nextCursor}
      />
    </div>
  );
}
