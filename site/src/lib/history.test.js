// Tests for the chart logic: the rules that decide what the history chart and
// stat cards show. Each test is named after the promise it checks.
import { describe, expect, it } from "vitest";
import {
  METRICS, eventsByPoint, formatTick, preparePoints, rangeStart, slugify, summarise, timeTicks, toCsv, valueScale,
  isolated, withGaps,
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

  it("labels months without anything that looks like a day, and January with its year", () => {
    expect(formatTick(new Date(2026, 7, 1).getTime() / 1000, "month")).not.toMatch(/\d/); // "Aug"
    expect(formatTick(new Date(2027, 0, 1).getTime() / 1000, "month")).toBe("2027");
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

describe("eventsByPoint (which reading gets an update's marker)", () => {
  const update = (t) => ({ t, kind: "update", detail: null });

  it("hourly: an update belongs to the first reading after it", () => {
    const map = eventsByPoint([update(10 * 60), update(46 * 60), update(HOUR + 10 * 60)], [0, HOUR, 2 * HOUR], "hour");
    expect(map.get(HOUR)).toEqual([update(10 * 60), update(46 * 60)]);
    expect(map.get(2 * HOUR)).toEqual([update(HOUR + 10 * 60)]);
    expect(map.has(0)).toBe(false);
  });

  it("hourly: an update during a missed reading belongs to the next reading", () => {
    const map = eventsByPoint([update(HOUR + 30 * 60)], [0, HOUR, 3 * HOUR], "hour");
    expect([...map.keys()]).toEqual([3 * HOUR]);
  });

  it("hourly: updates before the chart, or after the latest reading, aren't on it", () => {
    expect(eventsByPoint([update(-2 * HOUR), update(2 * HOUR + 60)], [0, HOUR, 2 * HOUR], "hour").size).toBe(0);
  });

  it("daily: an update belongs to the day it happened on", () => {
    const map = eventsByPoint([update(DAY + 7 * HOUR), update(DAY + 23 * HOUR), update(3 * DAY)], [0, DAY, 2 * DAY], "day");
    expect([...map]).toEqual([[DAY, [update(DAY + 7 * HOUR), update(DAY + 23 * HOUR)]]]);
  });
});

describe("gained per hour across a missed reading", () => {
  it("averages over a short gap instead of breaking the line", () => {
    const pts = preparePoints([point(0, { visits: 1000 }), point(2 * HOUR, { visits: 1600 })], "hour", DAY);
    expect(pts[1].visitsGained).toBe(300);
    expect(pts[1].gainedOver).toBe(2);
  });

  it("doesn't guess after a long gap", () => {
    const pts = preparePoints([point(0, { visits: 1000 }), point(5 * HOUR, { visits: 1600 })], "hour", DAY);
    expect(pts[1].visitsGained).toBeNull();
  });
});

describe("withGaps (where chart lines break)", () => {
  it("adds an empty marker after a gap of more than 3 hours, so the line breaks", () => {
    const out = withGaps([point(0), point(HOUR), point(6 * HOUR)], "hour");
    expect(out.map((p) => [p.t, Boolean(p.gap)])).toEqual([[0, false], [HOUR, false], [2 * HOUR, true], [6 * HOUR, false]]);
  });

  it("keeps short gaps joined (a missed reading or two)", () => {
    expect(withGaps([point(0), point(3 * HOUR)], "hour").some((p) => p.gap)).toBe(false);
  });

  it("measures daily charts in days", () => {
    expect(withGaps([point(0), point(3 * DAY)], "day").some((p) => p.gap)).toBe(false);
    expect(withGaps([point(0), point(5 * DAY)], "day").filter((p) => p.gap)).toEqual([{ t: DAY, gap: true }]);
  });
});

describe("isolated (lone readings get a dot)", () => {
  const rows = [{ v: 1 }, { v: null }, { v: 2 }, { v: null }, { v: 3 }, { v: 4 }];
  const v = (r) => r.v;
  it("is true only for a value with no value either side", () => {
    expect(rows.map((_, i) => isolated(rows, i, v))).toEqual([true, false, true, false, false, false]);
  });
});

describe("timeTicks for daily charts", () => {
  it("never labels a daily chart with times of day", () => {
    const start = new Date(2026, 10, 13).getTime() / 1000;
    const { unit, ticks } = timeTicks(start, start + DAY, 7, "day");
    expect(unit).toBe("day");
    expect(ticks).toEqual([start, start + DAY]);
  });
});
