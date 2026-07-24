import { randomBytes, randomUUID } from "node:crypto";
import { type App, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { TIMEZONE } from "../src/lib/shared/constants";
import { isHighAmount, pointsFor } from "../src/lib/shared/money";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

interface SeedUser {
  uid: string;
  email: string;
  displayName: string;
  studentNumber: string | null;
  roles: { sacMember: boolean; sacExec: boolean };
  fundCents?: number;
}

interface SeedItem {
  id: string;
  name: string;
  priceCents: number;
  isCustom: boolean;
}

interface SeedBooth {
  id: string;
  name: string;
  description: string;
  status: "pending" | "approved" | "deactivated";
  items: SeedItem[];
  joinCode: string | null;
  approved: boolean;
  memberUids: string[];
}

const STUDENTS: SeedUser[] = [
  {
    uid: "seed-student-ava",
    email: "843901@pdsb.net",
    displayName: "Ava Nguyen",
    studentNumber: "843901",
    roles: { sacMember: false, sacExec: false },
    fundCents: 5000,
  },
  {
    uid: "seed-student-ben",
    email: "843902@pdsb.net",
    displayName: "Ben Carter",
    studentNumber: "843902",
    roles: { sacMember: false, sacExec: false },
    fundCents: 2000,
  },
  {
    uid: "seed-student-chloe",
    email: "843903@pdsb.net",
    displayName: "Chloe Diaz",
    studentNumber: "843903",
    roles: { sacMember: false, sacExec: false },
  },
];

const TEACHER: SeedUser = {
  uid: "seed-teacher-murray",
  email: "jmurray@pdsb.net",
  displayName: "Jordan Murray",
  studentNumber: null,
  roles: { sacMember: false, sacExec: false },
};

const SAC_MEMBER: SeedUser = {
  uid: "seed-sac-member",
  email: "843950@pdsb.net",
  displayName: "Sam Lee",
  studentNumber: "843950",
  roles: { sacMember: true, sacExec: false },
};

const SAC_EXEC: SeedUser = {
  uid: "seed-sac-exec",
  email: "843951@pdsb.net",
  displayName: "Riley Kim",
  studentNumber: "843951",
  roles: { sacMember: true, sacExec: true },
};

const ALL_USERS: SeedUser[] = [...STUDENTS, TEACHER, SAC_MEMBER, SAC_EXEC];

function customItem(): SeedItem {
  return { id: "custom", name: "Custom", priceCents: 50, isCustom: true };
}

function item(name: string, priceCents: number): SeedItem {
  return { id: randomUUID(), name, priceCents, isCustom: false };
}

const BOOTHS: SeedBooth[] = [
  {
    id: "seed-booth-pending",
    name: "Taco Stand",
    description: "Fresh tacos and burritos, cash line only until approved.",
    status: "pending",
    items: [customItem(), item("Taco", 300), item("Burrito", 500)],
    joinCode: null,
    approved: false,
    memberUids: [],
  },
  {
    id: "seed-booth-approved",
    name: "Pizza Palace",
    description: "Slices by the pie, running the whole event.",
    status: "approved",
    items: [customItem(), item("Slice", 300), item("Whole Pie", 1500)],
    joinCode: "PIZZA-9K1",
    approved: true,
    memberUids: [STUDENTS[0]!.uid],
  },
  {
    id: "seed-booth-deactivated",
    name: "Candy Corner",
    description: "Sweets stall that was shut down mid-event.",
    status: "deactivated",
    items: [customItem(), item("Lollipop", 50), item("Chocolate Bar", 250)],
    joinCode: "CANDY-2X8",
    approved: true,
    memberUids: [],
  },
];

export interface SeedSummary {
  users: string[];
  booths: string[];
  ledgerEntries: number;
}

function assertEmulator(): void {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "seed-dev-data refuses to run: FIRESTORE_EMULATOR_HOST is unset. This script targets the emulator only and must never touch a cloud project.",
    );
  }
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      "seed-dev-data refuses to run: FIREBASE_AUTH_EMULATOR_HOST is unset. Start the Auth emulator before seeding.",
    );
  }
}

function seedApp(): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0]!;
  const projectId =
    process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "demo-fraserpay";
  return initializeApp({ projectId });
}

function paymentCode(): string {
  const bytes = randomBytes(16);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return `fp1-${out}`;
}

function torontoDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(at);
}

export async function seed(): Promise<SeedSummary> {
  assertEmulator();

  const app = seedApp();
  const auth = getAuth(app);
  const db = getFirestore(app);
  const now = Timestamp.now();
  const createdDate = torontoDate(now.toDate());

  for (const user of ALL_USERS) {
    await auth.deleteUser(user.uid).catch(() => undefined);
    await auth.createUser({
      uid: user.uid,
      email: user.email,
      emailVerified: true,
      displayName: user.displayName,
    });
  }

  const batch = db.batch();
  let ledgerEntries = 0;

  for (const user of ALL_USERS) {
    const funded = user.fundCents ?? 0;
    batch.set(db.collection("users").doc(user.uid), {
      email: user.email,
      displayName: user.displayName,
      displayNameLower: user.displayName.toLowerCase(),
      studentNumber: user.studentNumber,
      paymentCode: paymentCode(),
      balanceCents: funded,
      points: funded > 0 ? pointsFor(funded) : 0,
      roles: user.roles,
      suspended: false,
      createdAt: now,
      updatedAt: now,
    });

    if (funded > 0) {
      const entryId = `seed-topup-${user.uid}`;
      batch.set(db.collection("ledger").doc(entryId), {
        type: "topup",
        amountCents: funded,
        direction: "credit",
        balanceAfterCents: funded,
        studentUid: user.uid,
        studentNumber: user.studentNumber,
        studentName: user.displayName,
        actorUid: SAC_MEMBER.uid,
        actorName: SAC_MEMBER.displayName,
        method: "cash",
        tags: isHighAmount(funded) ? ["high-amount"] : [],
        pointsDelta: pointsFor(funded),
        idempotencyKey: entryId,
        createdAt: now,
        createdDate,
      });
      ledgerEntries += 1;
    }
  }

  for (const booth of BOOTHS) {
    batch.set(db.collection("booths").doc(booth.id), {
      name: booth.name,
      nameLower: booth.name.toLowerCase(),
      description: booth.description,
      status: booth.status,
      items: booth.items,
      joinCode: booth.joinCode,
      submitterUid: TEACHER.uid,
      submitterEmail: TEACHER.email,
      createdAt: now,
      ...(booth.approved ? { approvedAt: now, approvedByUid: SAC_EXEC.uid } : {}),
    });

    for (const uid of booth.memberUids) {
      const member = ALL_USERS.find((u) => u.uid === uid);
      if (!member) continue;
      batch.set(db.collection("booths").doc(booth.id).collection("members").doc(uid), {
        uid,
        displayName: member.displayName,
        joinedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  await batch.commit();

  return {
    users: ALL_USERS.map((u) => u.uid),
    booths: BOOTHS.map((b) => b.id),
    ledgerEntries,
  };
}

async function main(): Promise<void> {
  const summary = await seed();
  console.log("Seeded dev data against the emulator:");
  console.log(JSON.stringify(summary, null, 2));
}

function invokedDirectly(): boolean {
  const entry = process.argv[1] ?? "";
  return /seed-dev-data\.(ts|js|mjs)$/.test(entry);
}

if (invokedDirectly()) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
