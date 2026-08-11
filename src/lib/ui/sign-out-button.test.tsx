import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PURGE_CACHES_MESSAGE } from "../../../sw/sw-core.mjs";

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

import { SignOutButton } from "./sign-out-button";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  replace.mockClear();
  refresh.mockClear();
});

function stubServiceWorker(active: { postMessage: ReturnType<typeof vi.fn> } | null) {
  vi.stubGlobal("navigator", {
    serviceWorker: { getRegistration: vi.fn(async () => (active ? { active } : undefined)) },
  });
}

test("signs out, purges the SW caches, then routes to login", async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const postMessage = vi.fn((_msg, transfer: MessagePort[]) => {
    transfer[0]!.postMessage({ type: PURGE_CACHES_MESSAGE, ok: true });
  });
  stubServiceWorker({ postMessage });

  render(<SignOutButton />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/auth/signout",
    expect.objectContaining({ method: "POST" }),
  );
  expect(postMessage).toHaveBeenCalledWith(
    { type: PURGE_CACHES_MESSAGE },
    expect.arrayContaining([expect.any(MessagePort)]),
  );
  expect(refresh).toHaveBeenCalled();
});

test("still routes to login when no service worker controls the page", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200 })),
  );
  stubServiceWorker(null);

  render(<SignOutButton />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
});

test("stays put and reports failure when the server rejects sign-out", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 500 })),
  );
  const postMessage = vi.fn();
  stubServiceWorker({ postMessage });

  render(<SignOutButton />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

  await waitFor(() => expect(screen.getByText(/still signed in/i)).toBeTruthy());
  expect(replace).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  expect(postMessage).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Sign out" }).hasAttribute("disabled")).toBe(false);
});

test("stays put and reports failure when the network call throws", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
  const postMessage = vi.fn();
  stubServiceWorker({ postMessage });

  render(<SignOutButton />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

  await waitFor(() => expect(screen.getByText(/still signed in/i)).toBeTruthy());
  expect(replace).not.toHaveBeenCalled();
  expect(postMessage).not.toHaveBeenCalled();
});

test("treats 401 as already signed out and completes the purge + redirect", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 401 })),
  );
  const postMessage = vi.fn((_msg, transfer: MessagePort[]) => {
    transfer[0]!.postMessage({ type: PURGE_CACHES_MESSAGE, ok: true });
  });
  stubServiceWorker({ postMessage });

  render(<SignOutButton />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  expect(postMessage).toHaveBeenCalled();
});
