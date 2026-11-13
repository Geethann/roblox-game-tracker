// Tests for turning numbers and times into text. Run with `npm test`.
// The visitor's language decides some wording, so these compare against what
// the browser's own formatter says rather than hard-coding English.
import { describe, expect, it } from "vitest";
import { formatCompact, formatNumber, formatPercent, likeRatio, timeAgo } from "./format.js";

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

describe("number formatting", () => {
  it("shows a dash for missing numbers instead of 'NaN' or '0'", () => {
    expect(formatNumber(null)).toBe("—");
    expect(formatCompact(undefined)).toBe("—");
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(Infinity)).toBe("—");
  });

  it("adds a + sign only when asked, and never to zero", () => {
    expect(formatPercent(0.25, { signed: true })).toMatch(/^\+/);
    expect(formatPercent(-0.25, { signed: true })).toMatch(/^[-−]/);
    expect(formatPercent(0, { signed: true })).not.toMatch(/^\+/);
    expect(formatPercent(0.25)).not.toMatch(/^\+/);
  });
});

describe("likeRatio", () => {
  it("is likes as a share of all votes", () => {
    expect(likeRatio(900, 100)).toBe(0.9);
  });
  it("is unknown (not 0% or a crash) when there are no votes", () => {
    expect(likeRatio(0, 0)).toBeNull();
    expect(likeRatio(null, null)).toBeNull();
  });
});

describe("timeAgo", () => {
  const now = Date.UTC(2026, 10, 13, 12, 0, 0);
  const secondsAgo = (s) => now / 1000 - s;

  it("picks the largest unit that fits", () => {
    expect(timeAgo(secondsAgo(3 * 86_400), now)).toBe(relative.format(-3, "day"));
    expect(timeAgo(secondsAgo(2 * 3_600), now)).toBe(relative.format(-2, "hour"));
    expect(timeAgo(secondsAgo(5 * 60), now)).toBe(relative.format(-5, "minute"));
  });
  it("says 'just now' for under a minute", () => {
    expect(timeAgo(secondsAgo(20), now)).toBe("just now");
  });
});
