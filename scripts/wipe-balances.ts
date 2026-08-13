import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { type App, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, type Firestore, getFirestore } from "firebase-admin/firestore";
import { usingEmulators } from "../src/lib/shared/emulator-mode";

const BATCH_LIMIT = 450;
const WIPE_STATE_PATH = "operations/balanceWipe";

export interface WipeBalancesResult {
  usersScanned: number;
  balancesZeroed: number;
  totalCentsCleared: number;
}

function hasStalePrecondition(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === 9 || code === "failed-precondition";
}

export async function wipeBalances(db: Firestore): Promise<WipeBalancesResult> {
  const runId = randomUUID();
  const wipeStateRef = db.doc(WIPE_STATE_PATH);
  const users = db.collection("users");
  const usersScanned = (await users.count().get()).data().count;
  let balancesZeroed = 0;
  let totalCentsCleared = 0;

  await wipeStateRef.set({ runId, status: "running", startedAt: FieldValue.serverTimestamp() });

  while (true) {
    const snapshot = await users.where("balanceCents", "!=", 0).limit(BATCH_LIMIT).get();

    if (snapshot.empty) {
      const complete = await db.runTransaction(async (transaction) => {
        const remaining = await transaction.get(users.where("balanceCents", "!=", 0).limit(1));
        if (!remaining.empty) return false;
        transaction.set(
          wipeStateRef,
          {
            runId,
            status: "complete",
            completedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return true;
      });
      if (complete) break;
      continue;
    }

    const batch = db.batch();
    let batchTotalCents = 0;
    for (const doc of snapshot.docs) {
      const balanceCents = (doc.data().balanceCents as number | undefined) ?? 0;
      batch.update(
        doc.ref,
        { balanceCents: 0, updatedAt: FieldValue.serverTimestamp() },
        { lastUpdateTime: doc.updateTime },
      );
      batchTotalCents += balanceCents;
    }

    try {
      await batch.commit();
    } catch (error) {
      if (hasStalePrecondition(error)) continue;
      throw error;
    }
    balancesZeroed += snapshot.size;
    totalCentsCleared += batchTotalCents;
  }

  return { usersScanned, balancesZeroed, totalCentsCleared };
}

interface Args {
  project?: string;
  confirm?: string;
  exported: boolean;
  yes: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { exported: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--project") args.project = argv[++i];
    else if (arg.startsWith("--project=")) args.project = arg.slice("--project=".length);
    else if (arg === "--confirm") args.confirm = argv[++i];
    else if (arg.startsWith("--confirm=")) args.confirm = arg.slice("--confirm=".length);
    else if (arg === "--i-have-exported") args.exported = true;
    else if (arg === "--yes" || arg === "-y") args.yes = true;
  }
  return args;
}

export type WipePlan = { proceed: true; project: string } | { proceed: false; reason: string };

export function resolveWipePlan(args: Args, emulator: boolean): WipePlan {
  if (!args.project) {
    return { proceed: false, reason: "Refusing to wipe without an explicit --project <id>." };
  }
  if (!args.confirm) {
    return {
      proceed: false,
      reason: "Refusing to wipe without --confirm <id> (retype the project id to confirm).",
    };
  }
  if (args.confirm !== args.project) {
    return {
      proceed: false,
      reason: `Confirmation did not match: --project "${args.project}" vs --confirm "${args.confirm}". Aborting without changes.`,
    };
  }
  if (!args.exported) {
    return {
      proceed: false,
      reason:
        "Refusing to wipe without --i-have-exported. Take a fresh `gcloud firestore export` snapshot first, then pass the flag.",
    };
  }
  if (emulator && !args.project.startsWith("demo-")) {
    return {
      proceed: false,
      reason:
        `Emulator host vars are set, so firebase-admin would target the local emulator — not cloud project "${args.project}". ` +
        "Unset FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST to wipe a real project.",
    };
  }
  return { proceed: true, project: args.project };
}

function resolveApp(project: string): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0]!;

  if (usingEmulators(["firestore"])) {
    process.env.METADATA_SERVER_DETECTION ??= "none";
    return initializeApp({ projectId: project });
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

async function confirmCloud(project: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(
      `About to ZERO every balance on the CLOUD project "${project}" (points and ledger are preserved). ` +
        `Type the project id once more to proceed: `,
    );
    return answer.trim() === project;
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const emulator = usingEmulators(["firestore"]);
  const plan = resolveWipePlan(args, emulator);
  if (!plan.proceed) {
    console.error(plan.reason);
    process.exitCode = 1;
    return;
  }

  if (!emulator && !args.yes && !(await confirmCloud(plan.project))) {
    console.error("Confirmation did not match; aborting without changes.");
    process.exitCode = 1;
    return;
  }

  const db = getFirestore(resolveApp(plan.project));
  const result = await wipeBalances(db);
  console.log("wipe-balances:", JSON.stringify({ project: plan.project, ...result }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
