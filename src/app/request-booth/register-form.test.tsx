import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { boothDraftStorageKey } from "@/lib/ui/booth-draft";
import { BoothRegisterForm } from "./register-form";

const ACTOR_UID = "register-user";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

function okResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ boothId: "b1", status: "pending" }),
  } as unknown as Response;
}

function errorResponse(code: string, message: string, status = 400) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code, message, requestId: "req_1" } }),
  } as unknown as Response;
}

async function fillValidBooth() {
  await userEvent.type(screen.getByLabelText("Booth name"), "Taco Stand");
  await userEvent.type(screen.getByLabelText("Description"), "Fresh tacos");
  await userEvent.type(screen.getByLabelText("Item name"), "Taco");
  await userEvent.type(screen.getByLabelText("Price ($)"), "2.50");
}

function renderForm() {
  return render(<BoothRegisterForm actorUid={ACTOR_UID} />);
}

test("renders the registration form", () => {
  renderForm();
  expect(screen.getByLabelText("Booth name")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Submit for review" })).toBeInTheDocument();
});

test("rejects a non-$0.50 price client-side without calling the server", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  renderForm();
  await userEvent.type(screen.getByLabelText("Booth name"), "Taco Stand");
  await userEvent.type(screen.getByLabelText("Description"), "Fresh tacos");
  await userEvent.type(screen.getByLabelText("Item name"), "Taco");
  await userEvent.type(screen.getByLabelText("Price ($)"), "0.49");
  await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));

  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(fetchMock).not.toHaveBeenCalled();
});

test("valid submit posts the registration, clears its draft, and shows the review state", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse());
  vi.stubGlobal("fetch", fetchMock);

  renderForm();
  await fillValidBooth();
  localStorage.setItem(
    boothDraftStorageKey(ACTOR_UID),
    JSON.stringify({
      version: 1,
      draft: { name: "Old draft", description: "Old", items: [{ name: "Old", price: "1" }] },
    }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));

  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/SAC will review/i));

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/booths/register",
    expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({
        name: "Taco Stand",
        description: "Fresh tacos",
        items: [{ name: "Taco", priceCents: 250 }],
      }),
    }),
  );
  expect(localStorage.getItem(boothDraftStorageKey(ACTOR_UID))).toBeNull();
});

test("autosaves after the debounce and restores or discards a saved draft", async () => {
  const initial = renderForm();
  await new Promise((resolve) => setTimeout(resolve, 600));
  await userEvent.type(screen.getByLabelText("Booth name"), "Saved booth");
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(localStorage.getItem(boothDraftStorageKey(ACTOR_UID))).toContain("Saved booth");
  initial.unmount();

  const restored = renderForm();
  await waitFor(() => expect(screen.getByRole("alertdialog")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Restore" }));
  expect(screen.getByLabelText("Booth name")).toHaveValue("Saved booth");
  restored.unmount();

  renderForm();
  await waitFor(() => expect(screen.getByRole("alertdialog")).toBeInTheDocument());
  await userEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(localStorage.getItem(boothDraftStorageKey(ACTOR_UID))).toBeNull();
  expect(screen.getByLabelText("Booth name")).toHaveValue("");
});

test("flushes a draft when the page is closed before the debounce", async () => {
  const rendered = renderForm();
  await userEvent.type(screen.getByLabelText("Booth name"), "Closing booth");

  window.dispatchEvent(new Event("pagehide"));

  expect(localStorage.getItem(boothDraftStorageKey(ACTOR_UID))).toContain("Closing booth");
  rendered.unmount();
});

test("surfaces a single unobtrusive notice when storage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });

  renderForm();
  await waitFor(() =>
    expect(screen.getByText(/Draft autosave isn.t available/i)).toBeInTheDocument(),
  );
  expect(screen.getAllByText(/Draft autosave isn.t available/i)).toHaveLength(1);
  await userEvent.type(screen.getByLabelText("Booth name"), "Still works");
  expect(screen.getByLabelText("Booth name")).toHaveValue("Still works");
});

test("surfaces a server error and stays on the form", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        errorResponse("VALIDATION", "Item prices must be a positive multiple of $0.50."),
      ),
  );

  renderForm();
  await fillValidBooth();
  await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));

  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/multiple of \$0\.50/i));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
