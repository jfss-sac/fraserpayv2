import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { type App, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, type Firestore, getFirestore } from "firebase-admin/firestore";

export type SeedSuperadminOutcome = "granted" | "already-exec" | "pending";

export interface SeedSuperadminResult {
  email: string;
  outcome: SeedSuperadminOutcome;
  uid: string | null;
}

export async function seedSuperadmin(db: Firestore, email: string): Promise<SeedSuperadminResult> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    throw new Error("seed-superadmin: no email given (set SEED_SUPERADMIN_EMAIL or pass --email).");
  }

  const match = await db.collection("users").where("email", "==", normalized).limit(1).get();

  if (!match.empty) {
    const doc = match.docs[0]!;
    const roles = (doc.data().roles ?? {}) as { sacMember?: boolean; sacExec?: boolean };
    if (roles.sacExec === true && roles.sacMember === true) {
      return { email: normalized, outcome: "already-exec", uid: doc.id };
    }
    await doc.ref.update({
      "roles.sacMember": true,
      "roles.sacExec": true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { email: normalized, outcome: "granted", uid: doc.id };
  }

  const pendingRef = db.collection("pendingRoleGrants").doc(normalized);
  const pending = await pendingRef.get();
  await pendingRef.set(
    {
      email: normalized,
      roles: { sacMember: true, sacExec: true },
      updatedAt: FieldValue.serverTimestamp(),
      ...(pending.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );
  return { email: normalized, outcome: "pending", uid: null };
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
      "Refusing to touch a cloud project without an explicit --project <id> (no emulator host detected).",
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

interface Args {
  project?: string;
  email?: string;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { yes: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--project") args.project = argv[++i];
    else if (arg.startsWith("--project=")) args.project = arg.slice("--project=".length);
    else if (arg === "--email") args.email = argv[++i];
    else if (arg.startsWith("--email=")) args.email = arg.slice("--email=".length);
    else if (arg === "--yes" || arg === "-y") args.yes = true;
  }
  return args;
}

async function confirmCloud(project: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(
      `About to grant SAC exec on the CLOUD project "${project}". Type the project id to confirm: `,
    );
    return answer.trim() === project;
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const { project, email, yes } = parseArgs(process.argv.slice(2));
  const targetEmail = email ?? process.env.SEED_SUPERADMIN_EMAIL;
  if (!targetEmail) {
    throw new Error("Set SEED_SUPERADMIN_EMAIL (or pass --email <address>).");
  }

  const emulator = usingEmulators();

  if (emulator && project && !project.startsWith("demo-")) {
    throw new Error(
      `Emulator host vars are set, so firebase-admin would target the local emulator — not cloud project "${project}". ` +
        "Unset FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST (they are blank for any cloud environment) to seed a real project.",
    );
  }

  if (!emulator) {
    if (!project) {
      throw new Error("Cloud run requires an explicit --project <id> (no emulator host detected).");
    }
    if (!yes && !(await confirmCloud(project))) {
      console.error("Confirmation did not match; aborting without changes.");
      process.exitCode = 1;
      return;
    }
  }

  const db = getFirestore(resolveApp(project));
  const result = await seedSuperadmin(db, targetEmail);
  console.log("seed-superadmin:", JSON.stringify(result, null, 2));
  if (result.outcome === "pending") {
    console.log(
      `No account for ${result.email} yet — recorded a pending SAC exec grant, applied automatically on their first sign-in.`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
