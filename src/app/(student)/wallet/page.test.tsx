import { render } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

const { getSession, redirect, usersCol, ledgerCol, renderPaymentQrSvg, walletProps } = vi.hoisted(
  () => ({
    getSession: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
    usersCol: vi.fn(),
    ledgerCol: vi.fn(),
    renderPaymentQrSvg: vi.fn(() => "<svg data-qr></svg>"),
    walletProps: { current: null as unknown },
  }),
);

vi.mock("@/lib/server/dal", () => ({ getSession }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-nonce": "test-nonce" }),
}));
vi.mock("@/lib/server/db", () => ({ usersCol, ledgerCol }));
vi.mock("@/lib/server/qr", () => ({ renderPaymentQrSvg }));
vi.mock("./wallet-view", () => ({
  WalletView: (props: unknown) => {
    walletProps.current = props;
    return null;
  },
}));

import WalletPage from "./page";

const SESSION = {
  uid: "u1",
  paymentCode: "fp1-ABCDEFGHJKMNPQRSTVWXYZ0123",
  studentNumber: "800123",
  balanceCents: 1250,
  points: 100,
};

function mockLedger(docs: { id: string; data: () => unknown }[]) {
  const snap = { docs };
  const query = {
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    get: async () => snap,
  };
  ledgerCol.mockReturnValue(query);
}

beforeEach(() => {
  getSession.mockReset();
  redirect.mockClear();
  usersCol.mockReset();
  renderPaymentQrSvg.mockClear();
  walletProps.current = null;
  mockLedger([]);
});

test("redirects an unauthenticated visitor to /login", async () => {
  getSession.mockResolvedValue(null);
  await expect(WalletPage()).rejects.toThrow("REDIRECT:/login");
});

test("renders the wallet with a server-rendered QR and mapped history", async () => {
  getSession.mockResolvedValue(SESSION);
  mockLedger([
    {
      id: "e1",
      data: () => ({
        type: "purchase",
        direction: "debit",
        amountCents: 750,
        balanceAfterCents: 1250,
        createdAt: Timestamp.fromDate(new Date("2026-07-24T15:04:00.000Z")),
        boothName: "Taco Stand",
        lineItems: [{ itemId: "i1", name: "Taco", qty: 3, unitPriceCents: 250 }],
      }),
    },
  ]);

  render(await WalletPage());

  expect(renderPaymentQrSvg).toHaveBeenCalledWith("fp1-ABCDEFGHJKMNPQRSTVWXYZ0123");
  const props = walletProps.current as {
    qrSvg: string;
    studentNumber: string | null;
    balanceCents: number;
    points: number;
    history: { boothName?: string; createdAtIso: string; lineItems?: unknown[] }[];
  };
  expect(props.qrSvg).toBe("<svg data-qr></svg>");
  expect(props.studentNumber).toBe("800123");
  expect(props.balanceCents).toBe(1250);
  expect(props.points).toBe(100);
  expect(props.history).toHaveLength(1);
  expect(props.history[0].boothName).toBe("Taco Stand");
  expect(props.history[0].createdAtIso).toBe("2026-07-24T15:04:00.000Z");
});

test("renders the iOS install script with the request nonce", async () => {
  getSession.mockResolvedValue(SESSION);

  const { container } = render(await WalletPage());
  const script = Array.from(container.querySelectorAll("script")).find((candidate) =>
    candidate.innerHTML.includes("data-ios-install-hint"),
  );

  expect(script?.getAttribute("nonce")).toBe("test-nonce");
  expect(script?.innerHTML).toContain("display-mode");
  expect(script?.innerHTML).toContain("localStorage");
});

test("reuses the user snapshot loaded for the session instead of reading the user again", async () => {
  getSession.mockResolvedValue(SESSION);
  render(await WalletPage());

  expect(usersCol).not.toHaveBeenCalled();
  expect(renderPaymentQrSvg).toHaveBeenCalledWith(SESSION.paymentCode);
});
