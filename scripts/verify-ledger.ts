import { pathToFileURL } from "node:url";
import { type App, cert, getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";

const POINTS_EPSILON = 1e-6;

interface LedgerRow {
  studentUid: string;
  amountCents: number;
  direction: "credit" | "debit";
  pointsDelta?: number;
}

interface UserRow {
  balanceCents: number;
  points: number;
}

interface Totals {
  balanceCents: number;
  points: number;
  entryCount: number;
}

export interface Divergence {
  uid: string;
  userExists: boolean;
  ledgerEntryCount: number;
  expectedBalanceCents: number;
  actualBalanceCents: number;
  expectedPoints: number;
  actualPoints: number;
}

export interface VerifyLedgerReport {
  ok: boolean;
  usersChecked: number;
  ledgerEntries: number;
  divergences: Divergence[];
}

export interface VerifyLedgerOptions {
  onlyUids?: string[];
}

function signedAmount(row: LedgerRow): number {
  return row.direction === "credit" ? row.amountCents : -row.amountCents;
}

export async function verifyLedger(
  db: Firestore,
  options: VerifyLedgerOptions = {},
): Promise<VerifyLedgerReport> {
  const scope = options.onlyUids ? new Set(options.onlyUids) : null;

  const ledgerSnap = await db
    .collection("ledger")
    .select("studentUid", "amountCents", "direction", "pointsDelta")
    .get();

  const totals = new Map<string, Totals>();
  let ledgerEntries = 0;
  for (const doc of ledgerSnap.docs) {
    const row = doc.data() as LedgerRow;
    if (scope && !scope.has(row.studentUid)) continue;
    ledgerEntries += 1;
    const current = totals.get(row.studentUid) ?? { balanceCents: 0, points: 0, entryCount: 0 };
    current.balanceCents += signedAmount(row);
    current.points += row.pointsDelta ?? 0;
    current.entryCount += 1;
    totals.set(row.studentUid, current);
  }

  const usersSnap = await db.collection("users").select("balanceCents", "points").get();
  const users = new Map<string, UserRow>();
  for (const doc of usersSnap.docs) {
    if (scope && !scope.has(doc.id)) continue;
    const data = doc.data() as UserRow;
    users.set(doc.id, { balanceCents: data.balanceCents ?? 0, points: data.points ?? 0 });
  }

  const uids = new Set<string>([...users.keys(), ...totals.keys()]);
  const divergences: Divergence[] = [];
  for (const uid of uids) {
    const expected = totals.get(uid) ?? { balanceCents: 0, points: 0, entryCount: 0 };
    const actual = users.get(uid);
    const balanceMismatch = (actual?.balanceCents ?? 0) !== expected.balanceCents;
    const pointsMismatch = Math.abs((actual?.points ?? 0) - expected.points) > POINTS_EPSILON;
    if (!actual || balanceMismatch || pointsMismatch) {
      divergences.push({
        uid,
        userExists: Boolean(actual),
        ledgerEntryCount: expected.entryCount,
        expectedBalanceCents: expected.balanceCents,
        actualBalanceCents: actual?.balanceCents ?? 0,
        expectedPoints: expected.points,
        actualPoints: actual?.points ?? 0,
      });
    }
  }

  divergences.sort((a, b) => a.uid.localeCompare(b.uid));

  return {
    ok: divergences.length === 0,
    usersChecked: uids.size,
    ledgerEntries,
    divergences,
  };
}

export function formatReport(report: VerifyLedgerReport): string {
  if (report.ok) {
    return `verify-ledger: OK — ${report.usersChecked} users reconcile against ${report.ledgerEntries} ledger entries.`;
  }
  const lines = [
    `verify-ledger: FAIL — ${report.divergences.length} of ${report.usersChecked} users diverge from the ledger (${report.ledgerEntries} entries).`,
  ];
  for (const d of report.divergences) {
    const where = d.userExists ? "" : " [no user doc — orphan ledger entries]";
    lines.push(
      `  ${d.uid}${where}: balance expected ${d.expectedBalanceCents} actual ${d.actualBalanceCents}; ` +
        `points expected ${d.expectedPoints} actual ${d.actualPoints}; ${d.ledgerEntryCount} entries`,
    );
  }
  return lines.join("\n");
}

function usingEmulators(): boolean {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

function resolveApp(project: string | undefined): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0]!;

  if (usingEmulators()) {
    const projectId =
      project || process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "demo-fraserpay";
    return initializeApp({ projectId });
  }

  if (!project) {
    throw new Error(
      "Refusing to read a cloud project without an explicit --project <id> (no emulator host detected).",
    );
  }
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase admin credentials: set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY for the cloud project.",
    );
  }
  return initializeApp({ credential: cert({ projectId: project, clientEmail, privateKey }) });
}

function parseProject(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--project") return argv[++i];
    if (arg.startsWith("--project=")) return arg.slice("--project=".length);
  }
  return process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
}

async function main(): Promise<void> {
  const project = parseProject(process.argv.slice(2));
  const db = getFirestore(resolveApp(project));
  const report = await verifyLedger(db);
  console.log(formatReport(report));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
