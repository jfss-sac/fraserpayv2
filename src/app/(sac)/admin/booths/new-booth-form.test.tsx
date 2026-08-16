import { render as testingRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BoothList } from "./booth-list";
import { NewBoothForm, parseDollars } from "./new-booth-form";

const mocks = vi.hoisted(() => ({
  createBooth: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("./api", () => ({
  boothActionErrorMessage: () => "That action failed. Try again.",
  createBooth: mocks.createBooth,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("parseDollars", () => {
  test("accepts positive 50-cent steps", () => {
    expect(parseDollars("0.50")).toBe(50);
    expect(parseDollars("10")).toBe(1000);
    expect(parseDollars("10.50")).toBe(1050);
  });

  test("rejects zero, odd cents, and junk", () => {
    expect(parseDollars("0")).toBeNull();
    expect(parseDollars("0.49")).toBeNull();
    expect(parseDollars("not money")).toBeNull();
  });
});

describe("NewBoothForm", () => {
  test("lets an exec create a booth and shows the join code once", async () => {
    const user = userEvent.setup();
    mocks.createBooth.mockResolvedValue({
      boothId: "booth-1",
      status: "approved",
      joinCode: "TACO-4F2K9",
    });
    testingRender(<NewBoothForm />);

    await user.click(screen.getByRole("button", { name: "New booth ✦" }));
    await user.type(screen.getByLabelText("Booth name"), "Taco Stand");
    await user.type(screen.getByLabelText("Description"), "Fresh tacos all day");
    await user.type(screen.getByLabelText("Item name 1"), "Taco");
    await user.type(screen.getByLabelText("Price in dollars"), "2.50");
    await user.click(screen.getByRole("button", { name: "Create booth" }));

    expect(await screen.findByText("TACO-4F2K9")).toBeInTheDocument();
    expect(mocks.createBooth).toHaveBeenCalledWith({
      name: "Taco Stand",
      description: "Fresh tacos all day",
      items: [{ name: "Taco", priceCents: 250 }],
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("TACO-4F2K9")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New booth ✦" })).toBeInTheDocument();
  });

  test("does not expose the create action to a SAC member", () => {
    testingRender(<BoothList booths={[]} isExec={false} />);
    expect(screen.queryByRole("button", { name: "New booth ✦" })).not.toBeInTheDocument();
  });
});
