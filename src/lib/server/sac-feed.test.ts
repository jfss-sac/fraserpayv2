import { describe, expect, it } from "vitest";
import { flagRepeatBuyers } from "./sac-feed";
import { REPEAT_BUYER_THRESHOLD } from "@/lib/shared/constants";

function charges(studentUid: string, studentName: string, times: number) {
  return Array.from({ length: times }, () => ({ studentUid, studentName }));
}

describe("flagRepeatBuyers", () => {
  it("flags a buyer charged at the threshold within the window", () => {
    expect(flagRepeatBuyers(charges("u1", "Ada", REPEAT_BUYER_THRESHOLD))).toEqual([
      { studentUid: "u1", studentName: "Ada", charges: REPEAT_BUYER_THRESHOLD },
    ]);
  });

  it("leaves a busy but ordinary buyer alone one charge below the threshold", () => {
    expect(flagRepeatBuyers(charges("u1", "Ada", REPEAT_BUYER_THRESHOLD - 1))).toEqual([]);
  });

  it("counts each buyer separately rather than totalling the window", () => {
    const purchases = [
      ...charges("u1", "Ada", REPEAT_BUYER_THRESHOLD - 1),
      ...charges("u2", "Ben", REPEAT_BUYER_THRESHOLD - 1),
    ];
    expect(flagRepeatBuyers(purchases)).toEqual([]);
  });

  it("ranks the most-charged buyer first", () => {
    const purchases = [
      ...charges("u1", "Ada", REPEAT_BUYER_THRESHOLD),
      ...charges("u2", "Ben", REPEAT_BUYER_THRESHOLD + 5),
    ];
    expect(flagRepeatBuyers(purchases).map((b) => b.studentUid)).toEqual(["u2", "u1"]);
  });
});
