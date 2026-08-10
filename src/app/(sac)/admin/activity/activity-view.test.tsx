import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { ActivityActor, ActivityDTO } from "@/lib/shared/types";
import { ActivityView } from "./activity-view";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const suspendCalls: { uid: string; suspended: boolean }[] = [];
const suspendResult = { value: null as Error | null };
vi.mock("../students/[uid]/actions-api", () => ({
  execSuspend: async (studentUid: string, suspended: boolean) => {
    suspendCalls.push({ uid: studentUid, suspended });
    if (suspendResult.value) throw suspendResult.value;
    return { studentUid, suspended };
  },
  adminActionErrorMessage: () => "That action failed. Try again.",
}));

function actor(overrides: Partial<ActivityActor> & { uid: string }): ActivityActor {
  return {
    displayName: overrides.uid,
    suspended: false,
    totalRequests: 100,
    peakRequests: 50,
    blockedWindows: 0,
    lastSeenIso: "2026-08-10T15:04:00.000Z",
    scopes: [
      { scope: "lookup", peakRequests: 50, limit: 120, windowMs: 60_000, blockedWindows: 0 },
    ],
    ...overrides,
  };
}

function dto(overrides: Partial<ActivityDTO> = {}): ActivityDTO {
  return {
    actors: [],
    notableThreshold: 20,
    lookbackMs: 24 * 60 * 60 * 1000,
    truncated: false,
    ...overrides,
  };
}

afterEach(() => {
  suspendCalls.length = 0;
  suspendResult.value = null;
  vi.clearAllMocks();
});

test("says plainly when nobody has come close to a limit", () => {
  render(<ActivityView data={dto()} isExec viewerUid="me" />);
  expect(screen.getByText("No account has come close to a rate limit.")).toBeInTheDocument();
});

test("shows each actor's peak, total, and per-scope cap", () => {
  render(
    <ActivityView
      data={dto({ actors: [actor({ uid: "u1", displayName: "Opal Operator" })] })}
      isExec={false}
      viewerUid="me"
    />,
  );
  expect(screen.getByRole("link", { name: "Opal Operator" })).toHaveAttribute(
    "href",
    "/admin/students/u1",
  );
  expect(screen.getByText("50")).toBeInTheDocument();
  expect(screen.getByText(/100 requests/)).toBeInTheDocument();
  expect(screen.getByText(/peak 50 \/ min/)).toBeInTheDocument();
  expect(screen.getByText(/cap 120/)).toBeInTheDocument();
});

test("flags the windows an actor kept pushing through", () => {
  render(
    <ActivityView
      data={dto({
        actors: [
          actor({
            uid: "u1",
            blockedWindows: 3,
            scopes: [
              {
                scope: "lookup",
                peakRequests: 200,
                limit: 120,
                windowMs: 60_000,
                blockedWindows: 3,
              },
            ],
          }),
        ],
      })}
      isExec={false}
      viewerUid="me"
    />,
  );
  expect(screen.getByText(/3 blocked/)).toBeInTheDocument();
});

test("withholds the suspend action from a member", () => {
  render(
    <ActivityView data={dto({ actors: [actor({ uid: "u1" })] })} isExec={false} viewerUid="me" />,
  );
  expect(screen.queryByRole("button", { name: "Suspend account" })).not.toBeInTheDocument();
});

test("withholds the suspend action on the viewer's own row and on an already-suspended one", () => {
  render(
    <ActivityView
      data={dto({ actors: [actor({ uid: "me" }), actor({ uid: "u2", suspended: true })] })}
      isExec
      viewerUid="me"
    />,
  );
  expect(screen.queryByRole("button", { name: "Suspend account" })).not.toBeInTheDocument();
});

test("an exec suspends from the row after confirming, then the page reloads", async () => {
  render(
    <ActivityView
      data={dto({ actors: [actor({ uid: "u1", displayName: "Opal Operator" })] })}
      isExec
      viewerUid="me"
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Suspend account" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Opal Operator");
  expect(suspendCalls).toHaveLength(0);

  await userEvent.click(screen.getByRole("button", { name: "Suspend" }));
  expect(suspendCalls).toEqual([{ uid: "u1", suspended: true }]);
  expect(refresh).toHaveBeenCalledOnce();
});

test("keeps the dialog open and shows why when the suspend fails", async () => {
  suspendResult.value = new Error("nope");
  render(<ActivityView data={dto({ actors: [actor({ uid: "u1" })] })} isExec viewerUid="me" />);

  await userEvent.click(screen.getByRole("button", { name: "Suspend account" }));
  await userEvent.click(screen.getByRole("button", { name: "Suspend" }));

  expect(screen.getByRole("alert")).toHaveTextContent("That action failed. Try again.");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(refresh).not.toHaveBeenCalled();
});

test("warns when the scan hit its cap rather than implying full coverage", () => {
  render(<ActivityView data={dto({ truncated: true })} isExec viewerUid="me" />);
  expect(screen.getByRole("status")).toHaveTextContent(/more activity exists/i);
});
