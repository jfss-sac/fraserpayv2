import { render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const { headers } = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers({ "x-nonce": "test-nonce" })),
}));
vi.mock("next/headers", () => ({ headers }));

import { ServiceWorkerRegister } from "./sw-register";

afterEach(() => vi.unstubAllEnvs());

test("in production, registers /sw.js with updateViaCache none under the CSP nonce", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const { container } = render(await ServiceWorkerRegister());
  const script = container.querySelector("script");
  expect(script?.getAttribute("nonce")).toBe("test-nonce");
  expect(script?.innerHTML).toContain('navigator.serviceWorker.register("/sw.js"');
  expect(script?.innerHTML).toContain('updateViaCache:"none"');
});

test("outside production, never registers — retires any existing SW and its caches", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const { container } = render(await ServiceWorkerRegister());
  const html = container.querySelector("script")?.innerHTML ?? "";
  expect(html).not.toContain(".register(");
  expect(html).toContain("getRegistrations");
  expect(html).toContain("unregister");
  expect(html).toContain("fraserpay-cache-");
});

test("omits the nonce attribute when no CSP nonce is present", async () => {
  vi.stubEnv("NODE_ENV", "production");
  headers.mockResolvedValueOnce(new Headers());
  const { container } = render(await ServiceWorkerRegister());
  expect(container.querySelector("script")?.hasAttribute("nonce")).toBe(false);
});
