import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const { getSession, listMemberBooths, redirect } = vi.hoisted(() => ({
  getSession: vi.fn(),
  listMemberBooths: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/server/dal", () => ({ getSession, listMemberBooths }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/ui/sign-out-button", () => ({ SignOutButton: () => <button>Sign out</button> }));

import AccountPage from "./page";

const SESSION = {
  uid: "student-1",
  email: "123456@pdsb.net",
  displayName: "Ava Nguyen",
  studentNumber: "123456",
  paymentCode: "secret-payment-code",
  balanceCents: 1200,
  points: 4,
  roles: { sacMember: true, sacExec: false },
  suspended: false,
};

beforeEach(() => {
  getSession.mockReset();
  listMemberBooths.mockReset();
  redirect.mockClear();
  listMemberBooths.mockResolvedValue([]);
});

test("redirects a signed-out visitor to /login", async () => {
  getSession.mockResolvedValue(null);

  await expect(AccountPage()).rejects.toThrow("REDIRECT:/login");
  expect(listMemberBooths).not.toHaveBeenCalled();
});

test("renders identity, roles, and linked booth memberships without the payment code", async () => {
  getSession.mockResolvedValue(SESSION);
  listMemberBooths.mockResolvedValue([
    { id: "booth-1", name: "Ring Toss", status: "approved" },
    { id: "booth-2", name: "Bake Sale", status: "pending" },
  ]);

  render(await AccountPage());

  expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
  expect(screen.getByText("Ava Nguyen")).toBeInTheDocument();
  expect(screen.getByText("123456")).toBeInTheDocument();
  expect(screen.getByText("123456@pdsb.net")).toBeInTheDocument();
  expect(screen.getByText("Student")).toBeInTheDocument();
  expect(screen.getByText("SAC member")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ring Toss" })).toHaveAttribute("href", "/booth/booth-1");
  expect(screen.getByRole("link", { name: /Bake Sale.*Awaiting approval/ })).toHaveAttribute(
    "href",
    "/booth/booth-2",
  );
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  expect(screen.queryByText("secret-payment-code")).not.toBeInTheDocument();
  expect(screen.queryByText(/payment code/i)).not.toBeInTheDocument();
});

test("renders the teacher-pattern account without a student number", async () => {
  getSession.mockResolvedValue({
    ...SESSION,
    studentNumber: null,
    roles: { sacMember: false, sacExec: false },
  });

  render(await AccountPage());

  expect(screen.getByText("No student number")).toBeInTheDocument();
  expect(screen.getByText("Teacher")).toBeInTheDocument();
  expect(screen.queryByText("123456")).not.toBeInTheDocument();
});
