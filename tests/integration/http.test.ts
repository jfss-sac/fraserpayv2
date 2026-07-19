import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { defineHandler } from "../../src/lib/server/http";

const ORIGIN = "http://127.0.0.1";
const COLLECTION = "_http_smoke";

const save = defineHandler(
  { schema: z.object({ id: z.string(), label: z.string() }) },
  async ({ input }) => {
    await getAdminFirestore().collection(COLLECTION).doc(input.id).set({ label: input.label });
    return { savedId: input.id };
  },
);

function post(headers: Record<string, string>, body: unknown): Request {
  return new Request(`${ORIGIN}/api/smoke`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Integration test requires FIRESTORE_EMULATOR_HOST (run via emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(async () => {
  await getAdminFirestore().recursiveDelete(getAdminFirestore().collection(COLLECTION));
  vi.restoreAllMocks();
});

describe("defineHandler against the Firestore emulator", () => {
  it("round-trips a same-origin request and persists to Firestore", async () => {
    const res = await save(post({ origin: ORIGIN }, { id: "doc-1", label: "hello" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(await res.json()).toEqual({ savedId: "doc-1" });

    const snap = await getAdminFirestore().collection(COLLECTION).doc("doc-1").get();
    expect(snap.exists).toBe(true);
    expect(snap.data()).toEqual({ label: "hello" });
  });

  it("returns a VALIDATION envelope for a bad body and writes nothing", async () => {
    const res = await save(post({ origin: ORIGIN }, { id: "doc-2" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION");
    const snap = await getAdminFirestore().collection(COLLECTION).doc("doc-2").get();
    expect(snap.exists).toBe(false);
  });

  it("rejects a cross-origin mutation with a FORBIDDEN envelope", async () => {
    const res = await save(post({ origin: "http://evil.example" }, { id: "doc-3", label: "x" }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    const snap = await getAdminFirestore().collection(COLLECTION).doc("doc-3").get();
    expect(snap.exists).toBe(false);
  });
});
