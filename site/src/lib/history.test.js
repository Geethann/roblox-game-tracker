// Tests for the chart logic: the rules that decide what the history chart and
// stat cards show. Each test is named after the promise it checks.
import { describe, expect, it } from "vitest";
import {
  METRICS, preparePoints, rangeStart, slugify, summarise, timeTicks, toCsv, valueScale,
} from "./history.js";

const HOUR = 3600;
const DAY = 86_400;
const point = (t, extra = {}) => ({
  t, playing: 100, visits: 1000, favorites: 50, likes: 90, dislikes: 10, ...extra,
});

describe("preparePoints", () => {
  it("works out visits gained between consecutive hourly readings", () => {
    const pts = preparePoints([point(0, { visits: 1000 }), point(HOUR, { visits: 1250 })], "hour", 10 * DAY);
    expect(pts[0].visitsGained).toBeNull(); // nothing to compare the first reading with
    expect(pts[1].visitsGained).toBe(250);
  });

  it("doesn't guess across a gap in the readings", () => {
    const pts = preparePoints([point(0), point(3 * HOUR, { visits: 5000 })], "hour", 10 * DAY);
    expect(pts[1].visitsGained).toBeNull();
  });

  it("leaves today's unfinished day out of daily gains (no fake drop at the end)", () => {
    const now = 10 * DAY + 6 * HOUR; // 06:00 on day 10
    const pts = preparePoints([point(9 * DAY, { visits: 1000 }), point(10 * DAY, { visits: 1100 })], "day", now);
    expect(pts[1].partial).toBe(true);
    expect(pts[1].visitsGained).toBeNull();
  });

  it("lets favourites go down (people un-favourite) but never visits", () => {
    const pts = preparePoints([point(0, { favorites: 50, visits: 1000 }), point(HOUR, { favorites: 40, visits: 900 })], "hour", 10 * DAY);
    expect(pts[1].favoritesGained).toBe(-10);
    expect(pts[1].visitsGained).toBe(0);
  });

  it("adds the rating as likes ÷ votes", () => {
    expect(preparePoints([point(0)], "hour", DAY)[0].rating).toBe(0.9);
  });
});

describe("summarise", () => {
  it("returns nothing for no readings", () => {
    expect(summarise([])).toBeNull();
  });

  it("shows a peak but no changes when there's only one reading", () => {
    const s = summarise(preparePoints([point(0, { playing: 500 })], "hour", DAY));
    expect(s.peak).toBe(500);
    expect(s.visitsGained).toBeUndefined();
  });

  it("uses the daily peak, not the daily average, for Peak (hourly)", () => {
    const pts = [point(0, { playing: 100, peak: 900 }), point(DAY, { playing: 120, peak: 300 })];
    expect(summarise(pts).peak).toBe(900);
  });

  it("measures change from the first reading to the last", () => {
    const pts = preparePoints([point(0, { visits: 1000 }), point(HOUR, { visits: 1500 })], "hour", DAY);
    expect(summarise(pts).visitsGained).toBe(500);
  });
});

describe("valueScale", () => {
  it("starts amounts at zero", () => {
    expect(valueScale(METRICS.players, [500, 900]).domain[0]).toBe(0);
  });

  it("keeps a dip below zero visible", () => {
    expect(valueScale(METRICS.favorites, [-20, 50]).domain[0]).toBe(-20);
  });

  it("never zooms the rating to less than a 2-point span", () => {
    const [bottom, top] = valueScale(METRICS.rating, [0.862, 0.863]).domain;
    expect(top - bottom).toBeGreaterThanOrEqual(0.02);
  });

  it("puts rating labels on round steps, inside 0-100%", () => {
    const { domain, ticks } = valueScale(METRICS.rating, [0.991, 0.995]);
    expect(domain[1]).toBeLessThanOrEqual(1);
    for (const t of ticks) expect(Math.round(t * 1000) % 5).toBe(0); // multiples of 0.5 percentage points
  });
});

describe("timeTicks", () => {
  it("puts at most 7 labels on whole hours for a day", () => {
    const start = Date.UTC(2026, 10, 12, 13, 27) / 1000;
    const { ticks, unit } = timeTicks(start, start + DAY);
    expect(unit).toBe("hour");
    expect(ticks.length).toBeLessThanOrEqual(7);
    for (const t of ticks) {
      expect(new Date(t * 1000).getMinutes()).toBe(0);
      expect(t).toBeGreaterThanOrEqual(start);
    }
  });

  it("switches to months for a year", () => {
    const start = Date.UTC(2025, 10, 13) / 1000;
    expect(timeTicks(start, start + 365 * DAY).unit).toBe("month");
  });
});

describe("rangeStart", () => {
  it("starts YTD on 1 January", () => {
    expect(rangeStart("ytd", Date.UTC(2026, 10, 13))).toBe(Date.UTC(2026, 0, 1) / 1000);
  });
  it("starts 'all' at the beginning of time", () => {
    expect(rangeStart("all")).toBe(0);
  });
});

describe("CSV export", () => {
  it("has a header and one row per reading, with blanks for missing values", () => {
    const csv = toCsv(preparePoints([point(0), point(HOUR)], "hour", DAY), "hour").split("\n");
    expect(csv[0]).toMatch(/^time_utc,players,visits/);
    expect(csv).toHaveLength(3);
    expect(csv[1]).toContain(",,"); // the first reading has no "gained" values
  });

  it("makes safe file names from game titles", () => {
    expect(slugify("[🎃] Jujutsu Shenanigans!")).toBe("jujutsu-shenanigans");
    expect(slugify("🎃🎃")).toBe("game");
  });
});
