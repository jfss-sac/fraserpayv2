import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { BoothJoinForm } from "./join-form";

afterEach(() => {
  vi.unstubAllGlobals();
});

function okResponse(name: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ boothId: "b1", name }),
  } as unknown as Response;
}

function errorResponse(code: string, message: string, status = 404) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code, message, requestId: "req_1" } }),
  } as unknown as Response;
}

test("renders the join form", () => {
  render(<BoothJoinForm />);
  expect(screen.getByLabelText("Join code")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Join booth" })).toBeInTheDocument();
});

test("rejects an empty code client-side without calling the server", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  render(<BoothJoinForm />);
  await userEvent.click(screen.getByRole("button", { name: "Join booth" }));

  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(fetchMock).not.toHaveBeenCalled();
});

test("normalizes the code and shows the joined state on success", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse("Taco Stand"));
  vi.stubGlobal("fetch", fetchMock);

  render(<BoothJoinForm />);
  await userEvent.type(screen.getByLabelText("Join code"), " taco-4f2 ");
  await userEvent.click(screen.getByRole("button", { name: "Join booth" }));

  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Taco Stand/));

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/booths/join",
    expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({ code: "TACO-4F2" }),
    }),
  );
});

test("surfaces a generic server error and stays on the form", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(errorResponse("NOT_FOUND", "That join code isn't valid.")),
  );

  render(<BoothJoinForm />);
  await userEvent.type(screen.getByLabelText("Join code"), "ZZZZ-999");
  await userEvent.click(screen.getByRole("button", { name: "Join booth" }));

  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/isn't valid/));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
