import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BoothRegisterForm } from "./register-form";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
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

test("renders the registration form", () => {
  render(<BoothRegisterForm />);
  expect(screen.getByLabelText("Booth name")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Submit for review" })).toBeInTheDocument();
});

test("rejects a non-$0.50 price client-side without calling the server", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  render(<BoothRegisterForm />);
  await userEvent.type(screen.getByLabelText("Booth name"), "Taco Stand");
  await userEvent.type(screen.getByLabelText("Description"), "Fresh tacos");
  await userEvent.type(screen.getByLabelText("Item name"), "Taco");
  await userEvent.type(screen.getByLabelText("Price ($)"), "0.49");
  await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));

  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(fetchMock).not.toHaveBeenCalled();
});

test("valid submit posts the registration and shows the review state", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse());
  vi.stubGlobal("fetch", fetchMock);

  render(<BoothRegisterForm />);
  await fillValidBooth();
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

  render(<BoothRegisterForm />);
  await fillValidBooth();
  await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));

  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/multiple of \$0\.50/i));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
