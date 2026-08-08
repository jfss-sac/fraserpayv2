import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { Timestamp } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as authSession } from "../../src/app/api/auth/session/route";
import { POST as authSignout } from "../../src/app/api/auth/signout/route";
import { GET as boothSummary } from "../../src/app/api/booth/[id]/summary/route";
import { POST as boothCharge } from "../../src/app/api/booth/charge/route";
import { POST as boothLookup } from "../../src/app/api/booth/lookup/route";
import { POST as boothsJoin } from "../../src/app/api/booths/join/route";
import { POST as boothsRegister } from "../../src/app/api/booths/register/route";
import { POST as execAdjust } from "../../src/app/api/exec/adjust/route";
import { POST as execBoothApprove } from "../../src/app/api/exec/booths/[id]/approve/route";
import { POST as execBoothItems } from "../../src/app/api/exec/booths/[id]/items/route";
import { POST as execBoothMemberRemove } from "../../src/app/api/exec/booths/[id]/members/remove/route";
import { POST as execBoothRotateCode } from "../../src/app/api/exec/booths/[id]/rotate-code/route";
import { POST as execBoothStatus } from "../../src/app/api/exec/booths/[id]/status/route";
import { POST as execPaymentCode } from "../../src/app/api/exec/payment-code/route";
import { POST as execRefund } from "../../src/app/api/exec/refund/route";
import { POST as execRoles } from "../../src/app/api/exec/roles/route";
import { POST as execSuspend } from "../../src/app/api/exec/suspend/route";
import { GET as sacFeed } from "../../src/app/api/sac/feed/route";
import { POST as sacLookup } from "../../src/app/api/sac/lookup/route";
import { GET as sacReconciliation } from "../../src/app/api/sac/reconciliation/route";
import { GET as sacReports } from "../../src/app/api/sac/reports/route";
import { GET as sacStudentLedger } from "../../src/app/api/sac/students/[uid]/ledger/route";
import { GET as sacStudents } from "../../src/app/api/sac/students/route";
import { POST as sacTopup } from "../../src/app/api/sac/topup/route";
import { GET as wallet } from "../../src/app/api/wallet/route";
import { boothsCol, membersCol, usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { IDEMPOTENCY_HEADER } from "../../src/lib/server/idempotency";
import type { Role } from "../../src/lib/server/dal";
import type { RateLimitScope } from "../../src/lib/server/ratelimit";
import { RATE_LIMITS } from "../../src/lib/server/ratelimit";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";

const ORIGIN = "http://127.0.0.1";
const EVIL_ORIGIN = "https://evil.example";
const API_DIR = join(process.cwd(), "src/app/api");
const BOOTH_ID = "sweep-booth";

type AnyHandler = ((
  request: Request,
  ctx?: { params: Promise<Record<string, string>> },
) => Promise<Response>) & {
  config: { role?: Role; rateLimit?: RateLimitScope; idempotent?: boolean };
};

interface Endpoint {
  path: string;
  method: "GET" | "POST";
  handler: AnyHandler;
  role: Role;
  rateLimit?: RateLimitScope;
  idempotent?: boolean;
  params?: Record<string, string>;
  body?: unknown;
}

const ENDPOINTS: Endpoint[] = [
  {
    path: "/api/auth/session",
    method: "POST",
    handler: authSession as AnyHandler,
    role: "public",
    body: { idToken: "not-a-real-token" },
  },
  {
    path: "/api/auth/signout",
    method: "POST",
    handler: authSignout as AnyHandler,
    role: "session",
  },
  {
    path: "/api/wallet",
    method: "GET",
    handler: wallet as AnyHandler,
    role: "session",
    rateLimit: "reads",
  },
  {
    path: "/api/booths/register",
    method: "POST",
    handler: boothsRegister as AnyHandler,
    role: "active",
    rateLimit: "register",
    body: { name: "Sweep", description: "d", items: [{ name: "Item", priceCents: 100 }] },
  },
  {
    path: "/api/booths/join",
    method: "POST",
    handler: boothsJoin as AnyHandler,
    role: "active",
    rateLimit: "join",
    body: { code: "ABC123" },
  },
  {
    path: "/api/booth/lookup",
    method: "POST",
    handler: boothLookup as AnyHandler,
    role: "active",
    rateLimit: "lookup",
    body: { boothId: BOOTH_ID, buyer: { studentNumber: "900001" }, cartTotalCents: 100 },
  },
  {
    path: "/api/booth/charge",
    method: "POST",
    handler: boothCharge as AnyHandler,
    role: "active",
    rateLimit: "charge",
    idempotent: true,
    body: {
      boothId: BOOTH_ID,
      buyer: { studentNumber: "900001" },
      items: [{ itemId: "x", qty: 1 }],
    },
  },
  {
    path: "/api/booth/[id]/summary",
    method: "GET",
    handler: boothSummary as AnyHandler,
    role: "active",
    rateLimit: "reads",
    params: { id: BOOTH_ID },
  },
  {
    path: "/api/sac/topup",
    method: "POST",
    handler: sacTopup as AnyHandler,
    role: "sacMember",
    rateLimit: "topup",
    idempotent: true,
    body: { buyer: { studentNumber: "900001" }, amountCents: 500, method: "cash" },
  },
  {
    path: "/api/sac/lookup",
    method: "POST",
    handler: sacLookup as AnyHandler,
    role: "sacMember",
    rateLimit: "lookup",
    body: { buyer: { studentNumber: "900001" } },
  },
  {
    path: "/api/sac/students",
    method: "GET",
    handler: sacStudents as AnyHandler,
    role: "sacMember",
    rateLimit: "reads",
  },
  {
    path: "/api/sac/students/[uid]/ledger",
    method: "GET",
    handler: sacStudentLedger as AnyHandler,
    role: "sacMember",
    rateLimit: "reads",
    params: { uid: "sweep-student" },
  },
  {
    path: "/api/sac/feed",
    method: "GET",
    handler: sacFeed as AnyHandler,
    role: "sacMember",
    rateLimit: "reads",
  },
  {
    path: "/api/sac/reconciliation",
    method: "GET",
    handler: sacReconciliation as AnyHandler,
    role: "sacMember",
    rateLimit: "reads",
  },
  {
    path: "/api/sac/reports",
    method: "GET",
    handler: sacReports as AnyHandler,
    role: "sacMember",
    rateLimit: "reads",
  },
  {
    path: "/api/exec/refund",
    method: "POST",
    handler: execRefund as AnyHandler,
    role: "sacExec",
    rateLimit: "exec-mutations",
    idempotent: true,
    body: { originalEntryId: "nope", reason: "sweep" },
  },
  {
    path: "/api/exec/adjust",
    method: "POST",
    handler: execAdjust as AnyHandler,
    role: "sacExec",
    rateLimit: "exec-mutations",
    idempotent: true,
    body: { studentUid: "sweep-student", amountCents: 50, reason: "sweep" },
  },
  {
    path: "/api/exec/payment-code",
    method: "POST",
    handler: execPaymentCode as AnyHandler,
    role: "sacExec",
    rateLimit: "exec-mutations",
    body: { studentUid: "sweep-student" },
  },
  {
    path: "/api/exec/suspend",
    method: "POST",
    handler: execSuspend as AnyHandler,
    role: "sacExec",
    rateLimit: "exec-mutations",
    body: { studentUid: "sweep-student", suspended: true },
  },
  {
    path: "/api/exec/roles",
    method: "POST",
    handler: execRoles as AnyHandler,
    role: "sacExec",
    rateLimit: "exec-mutations",
    body: { targetUid: "sweep-student", role: "sacMember", grant: true },
  },
  {
    path: "/api/exec/booths/[id]/approve",
    method: "POST",
    handler: execBoothApprove as AnyHandler,
    role: "sacExec",
    rateLimit: "exec-mutations",
    params: { id: BOOTH_ID },
    body: {},
  },
  {
    path: "/api/exec/booths/[id]/items",
    method: "POST",
    handler: execBoothItems as AnyHandler,
    role: "sacExec",
    rateLimit: "exec-mutations",
    params: { id: BOOTH_ID },
    body: { items: [] },
  },
  {
    path: "/api/exec/booths/[id]/rotate-code",
    method: "POST",
    handler: execBoothRotateCode as AnyHandler,
    role: "sacExec",
    rateLimit: "exec-mutations",
    params: { id: BOOTH_ID },
    body: {},
  },
  {
    path: "/api/exec/booths/[id]/members/remove",
    method: "POST",
    handler: execBoothMemberRemove as AnyHandler,
    role: "sacExec",
    rateLimit: "exec-mutations",
    params: { id: BOOTH_ID },
    body: { uid: "sweep-student" },
  },
  {
    path: "/api/exec/booths/[id]/status",
    method: "POST",
    handler: execBoothStatus as AnyHandler,
    role: "sacExec",
    rateLimit: "exec-mutations",
    params: { id: BOOTH_ID },
    body: { status: "inactive" },
  },
];

const DEV_ONLY_ROUTES = ["/api/auth/dev-login"];

const FIXTURES = [
  { uid: "sweep-student", number: "900001", roles: {}, suspended: false, booth: false },
  { uid: "sweep-outsider", number: "900002", roles: {}, suspended: false, booth: false },
  { uid: "sweep-seller", number: "900003", roles: {}, suspended: false, booth: true },
  {
    uid: "sweep-member",
    number: "900004",
    roles: { sacMember: true },
    suspended: false,
    booth: false,
  },
  {
    uid: "sweep-suspended",
    number: "900005",
    roles: { sacMember: true, sacExec: true },
    suspended: true,
    booth: true,
  },
];

const cookies: Record<string, string> = {};

async function mintSessionCookie(uid: string): Promise<string> {
  const customToken = await getAdminAuth().createCustomToken(uid);
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
  if (!body.idToken) throw new Error(`emulator did not return an idToken: ${JSON.stringify(body)}`);
  return getAdminAuth().createSessionCookie(body.idToken, { expiresIn: SESSION_TTL_MS });
}

function call(
  endpoint: Endpoint,
  opts: { uid?: string; origin?: string; secFetchSite?: string; idempotencyKey?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: opts.origin ?? ORIGIN,
  };
  if (endpoint.idempotent) {
    headers[IDEMPOTENCY_HEADER] = opts.idempotencyKey ?? crypto.randomUUID();
  }
  if (opts.secFetchSite) headers["sec-fetch-site"] = opts.secFetchSite;
  if (opts.uid) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[opts.uid]}`;
  const request = new Request(`${ORIGIN}${endpoint.path}`, {
    method: endpoint.method,
    headers,
    ...(endpoint.method === "POST" ? { body: JSON.stringify(endpoint.body ?? {}) } : {}),
  });
  return endpoint.handler(
    request,
    endpoint.params ? { params: Promise.resolve(endpoint.params) } : undefined,
  );
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error?: { code: string } }).error?.code ?? "<none>";
}

async function routeFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await routeFiles(path)));
    else if (entry.name === "route.ts") out.push(path);
  }
  return out;
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      "Integration test requires the auth + firestore emulators (run via emulators:exec).",
    );
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await boothsCol()
    .doc(BOOTH_ID)
    .set({
      name: "Sweep Booth",
      nameLower: "sweep booth",
      description: "sweep",
      status: "approved",
      items: [{ id: "x", name: "Item", priceCents: 100, isCustom: false }],
      joinCode: "SWEEP1",
      submitterUid: "sweep-seller",
      submitterEmail: "900003@pdsb.net",
      createdAt: Timestamp.now(),
    });

  for (const f of FIXTURES) {
    await getAdminAuth()
      .deleteUser(f.uid)
      .catch(() => undefined);
    await getAdminAuth().createUser({
      uid: f.uid,
      email: `${f.number}@pdsb.net`,
      emailVerified: true,
    });
    await usersCol()
      .doc(f.uid)
      .set({
        email: `${f.number}@pdsb.net`,
        displayName: f.uid,
        displayNameLower: f.uid,
        studentNumber: f.number,
        paymentCode: `fp1-${f.uid}`,
        balanceCents: 10_000,
        points: 0,
        roles: { sacMember: f.roles.sacMember === true, sacExec: f.roles.sacExec === true },
        suspended: f.suspended,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    if (f.booth) {
      await membersCol(BOOTH_ID)
        .doc(f.uid)
        .set({ uid: f.uid, displayName: f.uid, joinedAt: Timestamp.now() });
    }
    cookies[f.uid] = await mintSessionCookie(f.uid);
  }
});

afterAll(async () => {
  const db = getAdminFirestore();
  await db.recursiveDelete(db.collection("users"));
  await db.recursiveDelete(db.collection("booths"));
  await db.recursiveDelete(db.collection("rateLimits"));
  await getAdminAuth().deleteUsers(FIXTURES.map((f) => f.uid));
  vi.restoreAllMocks();
});

describe("API surface coverage (arch §10)", () => {
  it("audits every route module in src/app/api", async () => {
    const discovered = (await routeFiles(API_DIR))
      .map((file) => `/api/${relative(API_DIR, file).split(sep).slice(0, -1).join("/")}`)
      .sort();
    const audited = [...ENDPOINTS.map((e) => e.path), ...DEV_ONLY_ROUTES].sort();
    expect(discovered).toEqual(audited);
  });

  it.each([
    { NODE_ENV: "production", NEXT_PUBLIC_USE_EMULATORS: "true" },
    { NODE_ENV: "development", NEXT_PUBLIC_USE_EMULATORS: "false" },
  ])("keeps the dev-login shortcut dead under %s", async (env) => {
    const { GET } = await import("../../src/app/api/auth/dev-login/route");
    vi.stubEnv("NODE_ENV", env.NODE_ENV as "production" | "development");
    vi.stubEnv("NEXT_PUBLIC_USE_EMULATORS", env.NEXT_PUBLIC_USE_EMULATORS);
    try {
      await expect(GET(new NextRequest(`${ORIGIN}/api/auth/dev-login`))).rejects.toMatchObject({
        digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404"),
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("rate-limit coverage (arch §11)", () => {
  it.each(ENDPOINTS)("$method $path is wired to its declared scope", ({ handler, rateLimit }) => {
    expect(handler.config.rateLimit).toBe(rateLimit);
  });

  it("declares the role arch §10 assigns to each endpoint", () => {
    for (const { path, handler, role } of ENDPOINTS) {
      expect({ path, role: handler.config.role ?? "public" }).toEqual({ path, role });
    }
  });

  it("declares idempotency on exactly the money mutations arch §10 marks", () => {
    for (const { path, handler, idempotent } of ENDPOINTS) {
      expect({ path, idempotent: handler.config.idempotent === true }).toEqual({
        path,
        idempotent: idempotent === true,
      });
    }
  });

  it("leaves no rate-limit scope unused", () => {
    const wired = new Set(ENDPOINTS.map((e) => e.rateLimit).filter(Boolean));
    expect([...Object.keys(RATE_LIMITS)].sort()).toEqual([...wired].sort());
  });

  it("keys every scope by authenticated uid, never by client IP", () => {
    expect([...new Set(Object.values(RATE_LIMITS).map((rule) => rule.key))]).toEqual(["uid"]);
  });
});

describe("same-origin enforcement (arch §15 CSRF)", () => {
  const mutating = ENDPOINTS.filter((e) => e.method === "POST");

  it.each(mutating)("$path rejects a cross-origin Origin header", async (endpoint) => {
    const res = await call(endpoint, { origin: EVIL_ORIGIN });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it.each(mutating)("$path rejects Sec-Fetch-Site: cross-site", async (endpoint) => {
    const res = await call(endpoint, { secFetchSite: "cross-site" });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("rejects cross-origin before authenticating, so no session is required to observe it", async () => {
    const endpoint = ENDPOINTS.find((e) => e.path === "/api/exec/suspend")!;
    const res = await call(endpoint, { origin: EVIL_ORIGIN, uid: "sweep-suspended" });
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });
});

describe("authentication sweep (I9)", () => {
  const guarded = ENDPOINTS.filter((e) => e.role !== "public");

  it.each(guarded)("$method $path rejects an anonymous caller", async (endpoint) => {
    const res = await call(endpoint);
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });
});

describe("suspended-user sweep (A3)", () => {
  const moneyAndAdmin = ENDPOINTS.filter((e) => e.role !== "public" && e.role !== "session");

  it.each(moneyAndAdmin)("$method $path rejects a suspended actor", async (endpoint) => {
    const res = await call(endpoint, { uid: "sweep-suspended" });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("SUSPENDED");
  });

  it("still lets a suspended user read their own wallet", async () => {
    const res = await call(
      ENDPOINTS.find((e) => e.path === "/api/wallet")!,
      {
        uid: "sweep-suspended",
      },
    );
    expect(res.status).toBe(200);
  });
});

describe("role sweep (arch §7)", () => {
  const sacOnly = ENDPOINTS.filter((e) => e.role === "sacMember" || e.role === "sacExec");
  const execOnly = ENDPOINTS.filter((e) => e.role === "sacExec");

  it.each(sacOnly)("$method $path is closed to a plain student", async (endpoint) => {
    const res = await call(endpoint, { uid: "sweep-student" });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it.each(execOnly)("$method $path is closed to a non-exec SAC member", async (endpoint) => {
    const res = await call(endpoint, { uid: "sweep-member" });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });
});

describe("IDOR sweep", () => {
  const boothScoped = ENDPOINTS.filter((e) =>
    ["/api/booth/lookup", "/api/booth/charge", "/api/booth/[id]/summary"].includes(e.path),
  );

  it.each(boothScoped)("$path re-checks booth membership for $method", async (endpoint) => {
    const res = await call(endpoint, { uid: "sweep-outsider" });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("admits the same calls for an actual member of that booth", async () => {
    const summary = ENDPOINTS.find((e) => e.path === "/api/booth/[id]/summary")!;
    const res = await call(summary, { uid: "sweep-seller" });
    expect(res.status).toBe(200);
  });

  it("does not let a booth member read another booth's summary", async () => {
    const summary = ENDPOINTS.find((e) => e.path === "/api/booth/[id]/summary")!;
    const res = await call(
      { ...summary, params: { id: "some-other-booth" } },
      { uid: "sweep-seller" },
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });
});
