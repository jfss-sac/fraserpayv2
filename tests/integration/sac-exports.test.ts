import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as ledgerExportRoute } from "../../src/app/api/exec/ledger/export/route";
import { GET as reconciliationExportRoute } from "../../src/app/api/sac/reconciliation/export/route";
import { GET as reconciliationRoute } from "../../src/app/api/sac/reconciliation/route";
import { GET as reportsExportRoute } from "../../src/app/api/sac/reports/export/route";
import { GET as reportsRoute } from "../../src/app/api/sac/reports/route";
import {
  type BoothDoc,
  type LedgerEntryDoc,
  auditCol,
  boothsCol,
  ledgerCol,
  usersCol,
} from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import {
  LEDGER_EXPORT_ROW_LIMIT,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from "../../src/lib/shared/constants";
import type { BoothItem, ReportsDTO, ReconciliationDTO } from "../../src/lib/shared/types";

const ORIGIN = "http://127.0.0.1";
const DATE = "2024-01-15";
const FROM = "2024-01-15T00:00:00.000Z";
const TO = "2024-01-16T00:00:00.000Z";

const MEMBER = { uid: "exports-member", name: "Ava Member" };
const EXEC = { uid: "exports-exec", name: "Xander Exec" };
const STUDENT = { uid: "exports-student", name: "Student Buyer" };
const BOOTH = "exports-booth";
const ITEMS: BoothItem[] = [{ id: "play", name: "Play", priceCents: 200, isCustom: false }];
const cookies: Record<string, string> = {};

async function mintSessionCookie(uid: string): Promise<string> {
  const customToken = await getAdminAuth().createCustomToken(uid);
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const response = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const body = (await response.json()) as { idToken?: string };
  if (!body.idToken) throw new Error("Auth emulator did not return an idToken.");
  return getAdminAuth().createSessionCookie(body.idToken, { expiresIn: SESSION_TTL_MS });
}

async function makeUser(
  uid: string,
  displayName: string,
  roles: { sacMember: boolean; sacExec: boolean },
): Promise<void> {
  await usersCol()
    .doc(uid)
    .set({
      email: `${uid}@pdsb.net`,
      displayName,
      displayNameLower: displayName.toLowerCase(),
      studentNumber: uid === STUDENT.uid ? "700001" : null,
      paymentCode: `fp1-${uid}`,
      balanceCents: uid === STUDENT.uid ? 300 : 0,
      points: 0,
      roles,
      suspended: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}

async function makeBooth(): Promise<void> {
  const booth: BoothDoc = {
    name: "Export Booth",
    nameLower: "export booth",
    description: "export test booth",
    status: "approved",
    items: ITEMS,
    joinCode: "EXPORT-7Q3R4",
    submitterUid: EXEC.uid,
    submitterEmail: `${EXEC.uid}@pdsb.net`,
    createdAt: Timestamp.now(),
  };
  await boothsCol().doc(BOOTH).set(booth);
}

let sequence = 0;
async function seedEntry(overrides: Partial<LedgerEntryDoc> = {}): Promise<string> {
  sequence += 1;
  const ref = ledgerCol().doc();
  await ref.set({
    type: "purchase",
    amountCents: 400,
    direction: "debit",
    balanceAfterCents: 0,
    studentUid: STUDENT.uid,
    studentNumber: "700001",
    studentName: STUDENT.name,
    actorUid: MEMBER.uid,
    actorName: MEMBER.name,
    tags: [],
    idempotencyKey: `exports-${sequence}`,
    createdAt: Timestamp.fromMillis(Date.parse("2024-01-15T15:00:00.000Z") + sequence * 1000),
    createdDate: DATE,
    boothId: BOOTH,
    boothName: "Export Booth",
    lineItems: [{ itemId: "play", name: "Play", qty: 2, unitPriceCents: 200 }],
    ...overrides,
  });
  return ref.id;
}

async function seedNormalData(): Promise<void> {
  await seedEntry();
  await seedEntry({ type: "topup", direction: "credit", amountCents: 500, method: "cash" });
  await seedEntry({ type: "topup", direction: "credit", amountCents: 1000, method: "card" });
  await seedEntry({
    type: "adjustment",
    direction: "debit",
    amountCents: 100,
    method: undefined,
    originalEntryId: "topup-1",
    actorUid: EXEC.uid,
    actorName: EXEC.name,
    lineItems: undefined,
  });
}

function cookie(uid: string): Record<string, string> {
  return { cookie: `${SESSION_COOKIE_NAME}=${cookies[uid]}` };
}

function getRequest(path: string, uid: string): Request {
  return new Request(`${ORIGIN}${path}`, { method: "GET", headers: cookie(uid) });
}

function postRequest(path: string, uid: string, body: unknown): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { ...cookie(uid), "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(body),
  });
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators.");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
  await makeUser(MEMBER.uid, MEMBER.name, { sacMember: true, sacExec: false });
  await makeUser(EXEC.uid, EXEC.name, { sacMember: true, sacExec: true });
  await makeUser(STUDENT.uid, STUDENT.name, { sacMember: false, sacExec: false });
  await makeBooth();
  cookies[MEMBER.uid] = await mintSessionCookie(MEMBER.uid);
  cookies[EXEC.uid] = await mintSessionCookie(EXEC.uid);
  cookies[STUDENT.uid] = await mintSessionCookie(STUDENT.uid);
});

beforeEach(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["ledger", "auditLog", "rateLimits"].map((name) => db.recursiveDelete(db.collection(name))),
  );
  await seedNormalData();
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["users", "booths", "ledger", "auditLog", "rateLimits"].map((name) =>
      db.recursiveDelete(db.collection(name)),
    ),
  );
  await getAdminAuth().deleteUsers([MEMBER.uid, EXEC.uid, STUDENT.uid]);
  vi.restoreAllMocks();
});

describe("aggregate CSV exports", () => {
  it("matches the reports and reconciliation page figures without student names", async () => {
    const reportsPage = (await (
      await reportsRoute(getRequest("/api/sac/reports", MEMBER.uid))
    ).json()) as ReportsDTO;
    const reports = await reportsExportRoute(getRequest("/api/sac/reports/export", MEMBER.uid));
    const reportCsv = await reports.text();
    expect(reports.status).toBe(200);
    expect(reports.headers.get("cache-control")).toBe("no-store");
    expect(reports.headers.get("content-disposition")).toMatch(/reports-\d{4}-\d{2}-\d{2}\.csv/);
    expect(reportCsv).toContain(String(reportsPage.grossTotalCents));
    expect(reportCsv).toContain(String(reportsPage.topups.totalCents));
    expect(reportCsv).toContain(String(reportsPage.outstandingLiabilityCents));
    expect(reportCsv).not.toContain(STUDENT.name);

    const reconPage = (await (
      await reconciliationRoute(getRequest(`/api/sac/reconciliation?date=${DATE}`, MEMBER.uid))
    ).json()) as ReconciliationDTO;
    const reconciliation = await reconciliationExportRoute(
      getRequest(`/api/sac/reconciliation/export?date=${DATE}`, MEMBER.uid),
    );
    const reconciliationCsv = await reconciliation.text();
    expect(reconciliation.status).toBe(200);
    expect(reconciliation.headers.get("content-disposition")).toContain(
      `reconciliation-${DATE}.csv`,
    );
    expect(reconciliationCsv).toContain(String(reconPage.totals.cashCents));
    expect(reconciliationCsv).toContain(String(reconPage.totals.cardCents));
    expect(reconciliationCsv).toContain(String(reconPage.totals.topupCount));
    expect(reconciliationCsv).not.toContain(STUDENT.name);
  });
});

describe("POST /api/exec/ledger/export", () => {
  it("forbids a SAC member", async () => {
    const response = await ledgerExportRoute(
      postRequest("/api/exec/ledger/export", MEMBER.uid, { from: FROM, to: TO }),
    );
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("FORBIDDEN");
    expect((await auditCol().get()).docs).toHaveLength(0);
  });

  it("streams itemized rows and writes exactly one audited export", async () => {
    const entryId = (await ledgerCol().where("type", "==", "purchase").limit(1).get()).docs[0]!.id;
    const response = await ledgerExportRoute(
      postRequest("/api/exec/ledger/export", EXEC.uid, { from: FROM, to: TO }),
    );
    const csv = await response.text();
    expect(response.status).toBe(200);
    expect(response.body).not.toBeNull();
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/ledger-\d{4}-\d{2}-\d{2}\.csv/);
    expect(response.headers.get("x-export-truncated")).toBe("false");
    expect(csv).toContain("buyer name");
    expect(csv).toContain(STUDENT.name);
    expect(csv).toContain("Play");
    expect(csv).toContain(entryId);

    const audits = (await auditCol().where("action", "==", "data.export").get()).docs;
    expect(audits).toHaveLength(1);
    expect(audits[0]!.data()).toMatchObject({
      action: "data.export",
      actorUid: EXEC.uid,
      details: {
        from: FROM,
        to: TO,
        rowCount: 4,
        rowLimit: LEDGER_EXPORT_ROW_LIMIT,
        truncated: false,
      },
    });
  });
});
