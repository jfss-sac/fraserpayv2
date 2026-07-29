import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type App, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, type WriteBatch } from "firebase-admin/firestore";
import { SESSION_TTL_MS, TIMEZONE } from "../src/lib/shared/constants";
import { pointsFor } from "../src/lib/shared/money";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const FIXTURES_PATH = resolve(process.cwd(), "load/fixtures/load-fixtures.json");

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const CONFIG = {
  booths: envInt("LOAD_BOOTHS", 40),
  sellersPerBooth: envInt("LOAD_SELLERS_PER_BOOTH", 2),
  chargeBuyers: envInt("LOAD_CHARGE_BUYERS", 300),
  topupBuyers: envInt("LOAD_TOPUP_BUYERS", 150),
  sacMembers: envInt("LOAD_SAC_MEMBERS", 4),
  contentionBuyers: envInt("LOAD_CONTENTION_BUYERS", 6),
  contentionSellers: envInt("LOAD_CONTENTION_SELLERS", 40),
  idempotencyBuyers: envInt("LOAD_IDEMPOTENCY_BUYERS", 30),
};

const ITEM_PRICE_CENTS = 50;
const CHARGE_BUYER_BALANCE_CENTS = 20_000;
const CONTENTION_BUYER_BALANCE_CENTS = 150;
const IDEMPOTENCY_BUYER_BALANCE_CENTS = 5_000;

interface UserSpec {
  uid: string;
  email: string;
  displayName: string;
  studentNumber: string;
  paymentCode: string;
  balanceCents: number;
  roles: { sacMember: boolean; sacExec: boolean };
}

interface BoothSpec {
  id: string;
  name: string;
  itemId: string;
  sellerUids: string[];
}

interface Cookie {
  uid: string;
  cookie: string;
}

interface BuyerRef {
  paymentCode: string;
  studentNumber: string;
  balanceCents: number;
}

interface SellerFixture {
  uid: string;
  cookie: string;
  boothId: string;
  itemId: string;
  priceCents: number;
}

export interface LoadFixtures {
  generatedAtEpochMs: number;
  itemPriceCents: number;
  charge: { sellers: SellerFixture[]; buyers: BuyerRef[] };
  topup: { sacMembers: Cookie[]; buyers: BuyerRef[] };
  contention: { sellers: SellerFixture[]; buyers: BuyerRef[] };
  idempotency: { sellers: SellerFixture[]; buyers: BuyerRef[] };
}

function assertEmulator(): void {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "seed-load-data refuses to run: FIRESTORE_EMULATOR_HOST is unset. This script targets the emulator only and must never touch a cloud project.",
    );
  }
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      "seed-load-data refuses to run: FIREBASE_AUTH_EMULATOR_HOST is unset. Start the Auth emulator before seeding.",
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

async function chunked<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

let studentSeq = 900_000;
function nextStudentNumber(): string {
  studentSeq += 1;
  return String(studentSeq);
}

function makeUser(
  uid: string,
  displayName: string,
  balanceCents: number,
  roles = { sacMember: false, sacExec: false },
): UserSpec {
  const studentNumber = nextStudentNumber();
  return {
    uid,
    email: `${studentNumber}@pdsb.net`,
    displayName,
    studentNumber,
    paymentCode: paymentCode(),
    balanceCents,
    roles,
  };
}

export async function seedLoad(): Promise<LoadFixtures> {
  assertEmulator();

  const app = seedApp();
  const auth = getAuth(app);
  const db = getFirestore(app);
  const now = Timestamp.now();
  const createdDate = torontoDate(now.toDate());

  const sellers: UserSpec[] = [];
  const booths: BoothSpec[] = [];
  for (let b = 0; b < CONFIG.booths; b++) {
    const boothId = `load-booth-${b}`;
    const sellerUids: string[] = [];
    for (let s = 0; s < CONFIG.sellersPerBooth; s++) {
      const uid = `load-seller-${b}-${s}`;
      sellers.push(makeUser(uid, `Seller ${b}-${s}`, 0));
      sellerUids.push(uid);
    }
    booths.push({ id: boothId, name: `Load Booth ${b}`, itemId: "item", sellerUids });
  }

  const contentionSellers: UserSpec[] = [];
  const contentionBoothId = "load-contention-booth";
  for (let s = 0; s < CONFIG.contentionSellers; s++) {
    const uid = `load-contention-seller-${s}`;
    contentionSellers.push(makeUser(uid, `Contention Seller ${s}`, 0));
  }
  booths.push({
    id: contentionBoothId,
    name: "Contention Booth",
    itemId: "item",
    sellerUids: contentionSellers.map((u) => u.uid),
  });

  const chargeBuyers: UserSpec[] = [];
  for (let i = 0; i < CONFIG.chargeBuyers; i++) {
    chargeBuyers.push(makeUser(`load-buyer-${i}`, `Buyer ${i}`, CHARGE_BUYER_BALANCE_CENTS));
  }

  const topupBuyers: UserSpec[] = [];
  for (let i = 0; i < CONFIG.topupBuyers; i++) {
    topupBuyers.push(makeUser(`load-topup-buyer-${i}`, `Topup Buyer ${i}`, 0));
  }

  const contentionBuyers: UserSpec[] = [];
  for (let i = 0; i < CONFIG.contentionBuyers; i++) {
    contentionBuyers.push(
      makeUser(
        `load-contention-buyer-${i}`,
        `Contention Buyer ${i}`,
        CONTENTION_BUYER_BALANCE_CENTS,
      ),
    );
  }

  const idempotencyBuyers: UserSpec[] = [];
  for (let i = 0; i < CONFIG.idempotencyBuyers; i++) {
    idempotencyBuyers.push(
      makeUser(`load-idem-buyer-${i}`, `Idem Buyer ${i}`, IDEMPOTENCY_BUYER_BALANCE_CENTS),
    );
  }

  const sacMembers: UserSpec[] = [];
  for (let i = 0; i < CONFIG.sacMembers; i++) {
    sacMembers.push(
      makeUser(`load-sac-${i}`, `Load SAC ${i}`, 0, { sacMember: true, sacExec: false }),
    );
  }

  const allUsers: UserSpec[] = [
    ...sellers,
    ...contentionSellers,
    ...chargeBuyers,
    ...topupBuyers,
    ...contentionBuyers,
    ...idempotencyBuyers,
    ...sacMembers,
  ];

  await chunked(
    allUsers.map((u) => u.uid),
    250,
    async (uid) => {
      await auth.deleteUser(uid).catch(() => undefined);
    },
  );
  await chunked(allUsers, 100, async (user) => {
    await auth.createUser({
      uid: user.uid,
      email: user.email,
      emailVerified: true,
      displayName: user.displayName,
    });
  });

  const item = { id: "item", name: "Load Item", priceCents: ITEM_PRICE_CENTS, isCustom: false };
  const submitterUid = sacMembers[0]?.uid ?? sellers[0]!.uid;

  const batches: WriteBatch[] = [];
  let batch = db.batch();
  let opsInBatch = 0;
  function stage(op: (b: WriteBatch) => void): void {
    if (opsInBatch >= 400) {
      batches.push(batch);
      batch = db.batch();
      opsInBatch = 0;
    }
    op(batch);
    opsInBatch += 1;
  }

  for (const user of allUsers) {
    stage((b) =>
      b.set(db.collection("users").doc(user.uid), {
        email: user.email,
        displayName: user.displayName,
        displayNameLower: user.displayName.toLowerCase(),
        studentNumber: user.studentNumber,
        paymentCode: user.paymentCode,
        balanceCents: user.balanceCents,
        points: user.balanceCents > 0 ? pointsFor(user.balanceCents) : 0,
        roles: user.roles,
        suspended: false,
        createdAt: now,
        updatedAt: now,
      }),
    );

    if (user.balanceCents > 0) {
      const entryId = `load-seed-topup-${user.uid}`;
      stage((b) =>
        b.set(db.collection("ledger").doc(entryId), {
          type: "topup",
          amountCents: user.balanceCents,
          direction: "credit",
          balanceAfterCents: user.balanceCents,
          studentUid: user.uid,
          studentNumber: user.studentNumber,
          studentName: user.displayName,
          actorUid: submitterUid,
          actorName: "Load Seed",
          method: "cash",
          tags: [],
          pointsDelta: pointsFor(user.balanceCents),
          idempotencyKey: entryId,
          createdAt: now,
          createdDate,
        }),
      );
    }
  }

  for (const booth of booths) {
    stage((b) =>
      b.set(db.collection("booths").doc(booth.id), {
        name: booth.name,
        nameLower: booth.name.toLowerCase(),
        description: `Load fixture booth ${booth.id}.`,
        status: "approved",
        items: [item],
        joinCode: null,
        submitterUid,
        submitterEmail: `${submitterUid}@pdsb.net`,
        createdAt: now,
        approvedAt: now,
        approvedByUid: submitterUid,
      }),
    );
    for (const uid of booth.sellerUids) {
      const seller = allUsers.find((u) => u.uid === uid)!;
      stage((b) =>
        b.set(db.collection("booths").doc(booth.id).collection("members").doc(uid), {
          uid,
          displayName: seller.displayName,
          joinedAt: now,
        }),
      );
    }
  }

  batches.push(batch);
  for (const b of batches) {
    await b.commit();
  }

  const sellerCookies = new Map<string, string>();
  await chunked([...sellers, ...contentionSellers, ...sacMembers], 40, async (user) => {
    sellerCookies.set(user.uid, await mintSessionCookie(auth, user.uid));
  });

  function sellerFixture(user: UserSpec, boothId: string): SellerFixture {
    return {
      uid: user.uid,
      cookie: sellerCookies.get(user.uid)!,
      boothId,
      itemId: item.id,
      priceCents: item.priceCents,
    };
  }

  function buyerRef(user: UserSpec): BuyerRef {
    return {
      paymentCode: user.paymentCode,
      studentNumber: user.studentNumber,
      balanceCents: user.balanceCents,
    };
  }

  const chargeSellerFixtures: SellerFixture[] = [];
  for (const booth of booths.filter((b) => b.id !== contentionBoothId)) {
    for (const uid of booth.sellerUids) {
      chargeSellerFixtures.push(
        sellerFixture(
          allUsers.find((u) => u.uid === uid)!,
          booth.id,
        ),
      );
    }
  }

  const contentionSellerFixtures = contentionSellers.map((u) =>
    sellerFixture(u, contentionBoothId),
  );

  const fixtures: LoadFixtures = {
    generatedAtEpochMs: now.toMillis(),
    itemPriceCents: ITEM_PRICE_CENTS,
    charge: { sellers: chargeSellerFixtures, buyers: chargeBuyers.map(buyerRef) },
    topup: {
      sacMembers: sacMembers.map((u) => ({ uid: u.uid, cookie: sellerCookies.get(u.uid)! })),
      buyers: topupBuyers.map(buyerRef),
    },
    contention: {
      sellers: contentionSellerFixtures,
      buyers: contentionBuyers.map(buyerRef),
    },
    idempotency: {
      sellers: chargeSellerFixtures,
      buyers: idempotencyBuyers.map(buyerRef),
    },
  };

  mkdirSync(dirname(FIXTURES_PATH), { recursive: true });
  writeFileSync(FIXTURES_PATH, JSON.stringify(fixtures, null, 2));

  return fixtures;
}

async function mintSessionCookie(auth: ReturnType<typeof getAuth>, uid: string): Promise<string> {
  const customToken = await auth.createCustomToken(uid);
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const body = (await res.json()) as { idToken?: string };
  if (!res.ok || !body.idToken) {
    throw new Error(`emulator custom-token exchange failed (${res.status})`);
  }
  return auth.createSessionCookie(body.idToken, { expiresIn: SESSION_TTL_MS });
}

async function main(): Promise<void> {
  const fixtures = await seedLoad();
  console.log("Seeded load fixtures against the emulator:");
  console.log(
    JSON.stringify(
      {
        chargeSellers: fixtures.charge.sellers.length,
        chargeBuyers: fixtures.charge.buyers.length,
        topupSacMembers: fixtures.topup.sacMembers.length,
        topupBuyers: fixtures.topup.buyers.length,
        contentionSellers: fixtures.contention.sellers.length,
        contentionBuyers: fixtures.contention.buyers.length,
        idempotencyBuyers: fixtures.idempotency.buyers.length,
        fixturesPath: FIXTURES_PATH,
      },
      null,
      2,
    ),
  );
}

function invokedDirectly(): boolean {
  const entry = process.argv[1] ?? "";
  return /seed-load-data\.(ts|js|mjs)$/.test(entry);
}

if (invokedDirectly()) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
