import { describe, expect, test } from "vitest";
import {
  customFeedTimeRange,
  feedTimeRangeForPreset,
  type FeedTimePreset,
} from "./feed-time-range";

const NOW = new Date("2026-08-16T12:00:00.000Z");

describe("feed time ranges", () => {
  test.each<[FeedTimePreset, string, string]>([
    ["15m", "2026-08-16T11:45:00.000Z", "2026-08-16T12:00:00.000Z"],
    ["30m", "2026-08-16T11:30:00.000Z", "2026-08-16T12:00:00.000Z"],
    ["60m", "2026-08-16T11:00:00.000Z", "2026-08-16T12:00:00.000Z"],
  ])("sets the %s preset instants", (preset, from, to) => {
    expect(feedTimeRangeForPreset(preset, NOW)).toMatchObject({ from, to });
  });

  test("resolves today in America/Toronto across the UTC day boundary", () => {
    expect(feedTimeRangeForPreset("today", new Date("2026-08-16T03:59:00.000Z"))).toMatchObject({
      from: "2026-08-15T04:00:00.000Z",
      to: "2026-08-16T04:00:00.000Z",
    });
    expect(feedTimeRangeForPreset("today", new Date("2026-08-16T04:01:00.000Z"))).toMatchObject({
      from: "2026-08-16T04:00:00.000Z",
      to: "2026-08-17T04:00:00.000Z",
    });
  });

  test("normalizes a custom absolute range to ISO instants", () => {
    expect(customFeedTimeRange("2026-08-16T10:00", "2026-08-16T11:00")).toMatchObject({
      from: "2026-08-16T10:00:00.000Z",
      to: "2026-08-16T11:00:00.000Z",
    });
  });

  test("rejects an incomplete or reversed custom range", () => {
    expect(customFeedTimeRange("", "2026-08-16T11:00")).toBeNull();
    expect(customFeedTimeRange("2026-08-16T11:00", "2026-08-16T10:00")).toBeNull();
  });
});
