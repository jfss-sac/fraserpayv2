import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GoogleSignIn } from "@/lib/ui/google-signin";

const getGoogleIdToken = vi.fn();
const replace = vi.fn();
let nextParam: string | null = null;

vi.mock("@/lib/ui/firebase-client", () => ({
  getGoogleIdToken: () => getGoogleIdToken(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(nextParam ? `next=${nextParam}` : ""),
}));

beforeEach(() => {
  getGoogleIdToken.mockReset();
  replace.mockReset();
  nextParam = null;
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function okResponse() {
  return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
}

function errorResponse(code: string, message: string, status = 403) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code, message, requestId: "req_1" } }),
  } as unknown as Response;
}

test("renders the sign-in button", () => {
  render(<GoogleSignIn />);
  expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
});

test("wrong-domain account shows a friendly error and never calls the server", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  getGoogleIdToken.mockResolvedValue({
    idToken: "tok",
    email: "someone@gmail.com",
    emailVerified: true,
  });

  render(<GoogleSignIn />);
  await userEvent.click(screen.getByRole("button"));

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(/school Google account/i),
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test("unverified school email is rejected client-side", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  getGoogleIdToken.mockResolvedValue({
    idToken: "tok",
    email: "123456@pdsb.net",
    emailVerified: false,
  });

  render(<GoogleSignIn />);
  await userEvent.click(screen.getByRole("button"));

  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(fetchMock).not.toHaveBeenCalled();
});

test("valid school account posts the token and redirects", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse());
  vi.stubGlobal("fetch", fetchMock);
  nextParam = "/wallet";
  getGoogleIdToken.mockResolvedValue({
    idToken: "tok-123",
    email: "123456@pdsb.net",
    emailVerified: true,
  });

  render(<GoogleSignIn />);
  await userEvent.click(screen.getByRole("button"));

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/wallet"));
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/auth/session",
    expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({ idToken: "tok-123" }),
    }),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("open-redirect next values fall back to root", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
  nextParam = "//evil.example.com";
  getGoogleIdToken.mockResolvedValue({
    idToken: "tok",
    email: "123456@pdsb.net",
    emailVerified: true,
  });

  render(<GoogleSignIn />);
  await userEvent.click(screen.getByRole("button"));

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
});

test("server rejection surfaces an error and no redirect", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse("FORBIDDEN", "nope")));
  getGoogleIdToken.mockResolvedValue({
    idToken: "tok",
    email: "123456@pdsb.net",
    emailVerified: true,
  });

  render(<GoogleSignIn />);
  await userEvent.click(screen.getByRole("button"));

  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(/school Google account/i),
  );
  expect(replace).not.toHaveBeenCalled();
});

test("cancelled popup resets without an error", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  getGoogleIdToken.mockResolvedValue(null);

  render(<GoogleSignIn />);
  await userEvent.click(screen.getByRole("button"));

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled(),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});
