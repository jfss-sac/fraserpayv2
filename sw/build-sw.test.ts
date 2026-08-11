import { describe, expect, test } from "vitest";
import { inlineCore } from "../scripts/build-sw.mjs";

describe("inlineCore", () => {
  test("inlines exported async functions into a classic service worker", () => {
    const core = inlineCore("export async function warmCache() { return true; }");

    expect(core).toBe("async function warmCache() { return true; }");
    expect(() => new Function(core)).not.toThrow();
  });
});
