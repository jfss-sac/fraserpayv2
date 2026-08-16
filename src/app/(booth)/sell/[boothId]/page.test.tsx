import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { BoothDTO } from "@/lib/shared/types";

const { getSession, isBoothOperator, getBoothCatalog, notFound, redirect, terminalProps } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    isBoothOperator: vi.fn(),
    getBoothCatalog: vi.fn(),
    notFound: vi.fn(() => {
      throw new Error("NOT_FOUND");
    }),
    redirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
    terminalProps: { current: null as unknown },
  }));

vi.mock("@/lib/server/dal", () => ({ getSession, isBoothOperator, getBoothCatalog }));
vi.mock("next/navigation", () => ({ notFound, redirect }));
vi.mock("./pos-terminal", () => ({
  PosTerminal: (props: unknown) => {
    terminalProps.current = props;
    return <p>terminal</p>;
  },
}));

import PosPage from "./page";

const SESSION = { uid: "exec-1", roles: { sacMember: true, sacExec: true }, suspended: false };

const BOOTH: BoothDTO = {
  id: "booth-1",
  name: "Pizza Palace",
  description: "Slices by the pie.",
  status: "approved",
  items: [{ id: "slice", name: "Slice", priceCents: 300, isCustom: false }],
};

function page() {
  return PosPage({ params: Promise.resolve({ boothId: "booth-1" }) });
}

beforeEach(() => {
  getSession.mockReset();
  getSession.mockResolvedValue(SESSION);
  isBoothOperator.mockReset();
  getBoothCatalog.mockReset();
  getBoothCatalog.mockResolvedValue(BOOTH);
  notFound.mockClear();
  redirect.mockClear();
  terminalProps.current = null;
});

test("opens the terminal for anyone the booth-operator test admits", async () => {
  isBoothOperator.mockResolvedValue(true);
  render(await page());
  expect(screen.getByText("terminal")).toBeInTheDocument();
  expect(terminalProps.current).toMatchObject({ boothId: "booth-1", actorUid: "exec-1" });
});

test("turns away anyone the booth-operator test refuses", async () => {
  isBoothOperator.mockResolvedValue(false);
  await expect(page()).rejects.toThrow("NOT_FOUND");
  expect(getBoothCatalog).not.toHaveBeenCalled();
});

test("gates on the whole session, not just the uid", async () => {
  isBoothOperator.mockResolvedValue(true);
  await page();
  expect(isBoothOperator).toHaveBeenCalledWith("booth-1", SESSION);
});
