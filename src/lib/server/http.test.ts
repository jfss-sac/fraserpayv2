import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineHandler } from "./http";

const ORIGIN = "http://localhost:3000";
const URL_BASE = `${ORIGIN}/api/echo`;

const echo = defineHandler({ schema: z.object({ value: z.number() }) }, ({ input, requestId }) => ({
  value: input.value,
  requestId,
}));

function post(headers: Record<string, string>, body: unknown): Request {
  return new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("defineHandler success path", () => {
  it("parses the body, echoes the result, and sets x-request-id", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await echo(post({ origin: ORIGIN }, { value: 7 }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const json = (await res.json()) as { value: number; requestId: string };
    expect(json.value).toBe(7);
    expect(json.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("logs exactly one structured line per request", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await echo(post({ origin: ORIGIN }, { value: 1 }));
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ event: "request", route: "/api/echo", level: "info" });
    expect(typeof line.latencyMs).toBe("number");
  });
});

describe("defineHandler validation", () => {
  it("rejects a body that fails the schema with a VALIDATION envelope", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await echo(post({ origin: ORIGIN }, { value: "nope" }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; requestId: string } };
    expect(json.error.code).toBe("VALIDATION");
    expect(json.error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("rejects malformed JSON with a VALIDATION envelope", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const req = new Request(URL_BASE, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: "{not json",
    });
    const res = await echo(req);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION");
  });
});

describe("defineHandler same-origin check", () => {
  const cases: Array<[string, Record<string, string>, boolean]> = [
    ["same-origin Origin header", { origin: ORIGIN }, true],
    ["cross-origin Origin header", { origin: "http://evil.example" }, false],
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }, false],
    ["Sec-Fetch-Site same-origin", { "sec-fetch-site": "same-origin" }, true],
    ["Sec-Fetch-Site same-site", { "sec-fetch-site": "same-site" }, true],
    ["no origin metadata", {}, true],
    ["malformed Origin header", { origin: "not-a-url" }, false],
  ];

  for (const [name, headers, allowed] of cases) {
    it(`${allowed ? "allows" : "rejects"} ${name}`, async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const res = await echo(post(headers, { value: 3 }));
      if (allowed) {
        expect(res.status).toBe(200);
      } else {
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
      }
    });
  }

  it("does not apply the origin check to GET requests", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const read = defineHandler({}, () => ({ ok: true }));
    const res = await read(
      new Request(`${ORIGIN}/api/read`, {
        method: "GET",
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("defineHandler role slot", () => {
  it("rejects a protected role with 401 when no session cookie is present", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const guarded = defineHandler({ role: "session" }, () => ({ ok: true }));
    const res = await guarded(post({ origin: ORIGIN }, {}));
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("UNAUTHORIZED");
    expect(JSON.stringify(json)).not.toContain("stack");
  });
});
