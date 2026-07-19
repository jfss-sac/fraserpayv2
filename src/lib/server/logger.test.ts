import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger";

function lines(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
  return spy.mock.calls.map((call: unknown[]) => JSON.parse(call[0] as string));
}

afterEach(() => {
  delete process.env.LOG_LEVEL;
  vi.restoreAllMocks();
});

describe("logger", () => {
  it("emits a single JSON line with ts, level, and record fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info({ event: "request", requestId: "req-1", route: "/api/x", latencyMs: 5 });

    const emitted = lines(spy);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      level: "info",
      event: "request",
      requestId: "req-1",
      route: "/api/x",
      latencyMs: 5,
    });
    expect(typeof emitted[0].ts).toBe("string");
    expect(Number.isNaN(Date.parse(emitted[0].ts as string))).toBe(false);
  });

  it("serializes an Error in the err field to name/message/stack", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.error({ event: "request", err: new Error("boom") });

    const err = lines(spy)[0].err as Record<string, unknown>;
    expect(err.name).toBe("Error");
    expect(err.message).toBe("boom");
    expect(typeof err.stack).toBe("string");
  });

  it("filters records below the configured LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "error";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.debug({ event: "a" });
    logger.info({ event: "b" });
    logger.warn({ event: "c" });
    logger.error({ event: "d" });

    expect(lines(spy).map((line) => line.event)).toEqual(["d"]);
  });
});
