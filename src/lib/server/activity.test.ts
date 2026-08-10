import { describe, expect, it } from "vitest";
import { type ActivityActorName, type ActivityWindow, buildActivity } from "./activity";
import { NOTABLE_WINDOW_REQUESTS, RATE_LIMITS } from "./ratelimit";

const MINUTE = 60_000;
const BASE = Date.UTC(2026, 7, 10, 12, 0, 0);

function names(
  entries: Record<string, Partial<ActivityActorName>>,
): Map<string, ActivityActorName> {
  return new Map(
    Object.entries(entries).map(([uid, value]) => [
      uid,
      { displayName: uid, suspended: false, ...value },
    ]),
  );
}

function window(overrides: Partial<ActivityWindow> & { uid: string }): ActivityWindow {
  return {
    scope: "lookup",
    requests: NOTABLE_WINDOW_REQUESTS,
    windowStartMs: BASE,
    ...overrides,
  };
}

describe("buildActivity", () => {
  it("groups an actor's windows into a total, a peak, and a per-scope breakdown", () => {
    const dto = buildActivity({
      windows: [
        window({ uid: "u1", scope: "lookup", requests: 30, windowStartMs: BASE }),
        window({ uid: "u1", scope: "lookup", requests: 45, windowStartMs: BASE + MINUTE }),
        window({ uid: "u1", scope: "charge", requests: 25, windowStartMs: BASE + 2 * MINUTE }),
      ],
      names: names({ u1: { displayName: "Opal Operator" } }),
      truncated: false,
    });

    expect(dto.actors).toHaveLength(1);
    expect(dto.actors[0]).toMatchObject({
      uid: "u1",
      displayName: "Opal Operator",
      totalRequests: 100,
      peakRequests: 45,
      blockedWindows: 0,
      lastSeenIso: new Date(BASE + 2 * MINUTE).toISOString(),
    });
    expect(dto.actors[0]!.scopes).toEqual([
      {
        scope: "lookup",
        peakRequests: 45,
        limit: RATE_LIMITS.lookup.limit,
        windowMs: RATE_LIMITS.lookup.windowMs,
        blockedWindows: 0,
      },
      {
        scope: "charge",
        peakRequests: 25,
        limit: RATE_LIMITS.charge.limit,
        windowMs: RATE_LIMITS.charge.windowMs,
        blockedWindows: 0,
      },
    ]);
  });

  it("counts a window as blocked only once it passed that scope's own limit", () => {
    const { limit } = RATE_LIMITS.charge;
    const dto = buildActivity({
      windows: [
        window({ uid: "u1", scope: "charge", requests: limit }),
        window({ uid: "u1", scope: "charge", requests: limit + 1, windowStartMs: BASE + MINUTE }),
        window({
          uid: "u1",
          scope: "charge",
          requests: limit + 9,
          windowStartMs: BASE + 2 * MINUTE,
        }),
      ],
      names: names({ u1: {} }),
      truncated: false,
    });

    expect(dto.actors[0]!.blockedWindows).toBe(2);
  });

  it("ranks the accounts that kept pushing past a limit above merely busy ones", () => {
    const dto = buildActivity({
      windows: [
        window({ uid: "busy", scope: "charge", requests: RATE_LIMITS.charge.limit }),
        window({ uid: "abusive", scope: "lookup", requests: RATE_LIMITS.lookup.limit + 1 }),
        window({ uid: "quiet", scope: "reads", requests: NOTABLE_WINDOW_REQUESTS }),
      ],
      names: names({ busy: {}, abusive: {}, quiet: {} }),
      truncated: false,
    });

    expect(dto.actors.map((a) => a.uid)).toEqual(["abusive", "busy", "quiet"]);
  });

  it("names an account it could not resolve rather than dropping its activity", () => {
    const dto = buildActivity({
      windows: [window({ uid: "ghost", requests: 99 })],
      names: names({}),
      truncated: true,
    });

    expect(dto.actors[0]).toMatchObject({
      uid: "ghost",
      displayName: "Unknown account",
      suspended: false,
      totalRequests: 99,
    });
    expect(dto.truncated).toBe(true);
  });

  it("carries the suspension flag through so the page can hide a spent action", () => {
    const dto = buildActivity({
      windows: [window({ uid: "u1" })],
      names: names({ u1: { suspended: true } }),
      truncated: false,
    });

    expect(dto.actors[0]!.suspended).toBe(true);
  });

  it("returns an empty roster rather than failing when nothing was notable", () => {
    expect(buildActivity({ windows: [], names: names({}), truncated: false })).toEqual({
      actors: [],
      notableThreshold: NOTABLE_WINDOW_REQUESTS,
      lookbackMs: expect.any(Number),
      truncated: false,
    });
  });
});
