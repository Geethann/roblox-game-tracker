// Tests for the chart logic: the rules that decide what the history chart and
// stat cards show. Each test is named after the promise it checks.
import { describe, expect, it } from "vitest";
import {
  METRICS, eventMarkers, eventsByPoint, preparePoints, rangeStart, slugify, summarise, timeTicks, toCsv, valueScale,
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

describe("eventsByPoint", () => {
  const update = (t) => ({ t, kind: "update", detail: null });

  it("hourly: an update belongs to the nearest reading, so hovering on its marker shows it", () => {
    const times = [0, HOUR, 2 * HOUR];
    const map = eventsByPoint([update(46 * 60), update(HOUR + 10 * 60)], times, "hour");
    expect(map.get(HOUR)).toEqual([update(46 * 60), update(HOUR + 10 * 60)]); // 0:46 is nearer 1:00 than 0:00
    expect(map.has(0)).toBe(false);
  });

  it("hourly: an update with no reading within an hour isn't attached (e.g. before tracking began)", () => {
    expect(eventsByPoint([update(-2 * HOUR)], [0, HOUR], "hour").size).toBe(0);
  });

  it("daily: an update belongs to the day it happened on", () => {
    const map = eventsByPoint([update(DAY + 23 * HOUR)], [0, DAY, 2 * DAY], "day");
    expect([...map.keys()]).toEqual([DAY]);
  });
});

describe("eventMarkers", () => {
  const update = (t) => ({ t, kind: "update", detail: null });
  const rename = (t, detail) => ({ t, kind: "rename", detail });

  it("hourly: leaves out updates outside the chart (before it starts, or after the latest reading)", () => {
    const markers = eventMarkers([update(-60), update(5 * HOUR), update(20 * HOUR + 35 * 60)], 0, 20 * HOUR, "hour");
    expect(markers.map((m) => m.t)).toEqual([5 * HOUR]);
  });

  it("hourly: updates close together share one marker, at the first one's time", () => {
    // a 20-hour chart groups updates within 24 minutes (2% of its width)
    const events = [update(12 * HOUR + 38 * 60), update(12 * HOUR + 50 * 60), rename(13 * HOUR + 30 * 60, "New")];
    const markers = eventMarkers(events, 0, 20 * HOUR, "hour");
    expect(markers).toEqual([
      { t: 12 * HOUR + 38 * 60, events: [events[0], events[1]] },
      { t: 13 * HOUR + 30 * 60, events: [events[2]] },
    ]);
  });

  it("hourly: the grouping scales with the chart (2 hours apart: one marker on 7 days, two on 20 hours)", () => {
    expect(eventMarkers([update(HOUR), update(3 * HOUR)], 0, 7 * DAY, "hour")).toHaveLength(1); // 3.4h window
    expect(eventMarkers([update(HOUR), update(3 * HOUR)], 0, 20 * HOUR, "hour")).toHaveLength(2);
  });

  it("daily: one marker per day, on that day's point, including today", () => {
    const events = [update(DAY + 7 * HOUR), update(DAY + 21 * HOUR), update(2 * DAY + HOUR), update(3 * DAY + HOUR)];
    const markers = eventMarkers(events, DAY, 2 * DAY, "day");
    expect(markers).toEqual([
      { t: DAY, events: [events[0], events[1]] },
      { t: 2 * DAY, events: [events[2]] },
    ]);
  });
});

describe("eventMarkers spacing (worked out from the chart's width on screen)", () => {
  const update = (t) => ({ t, kind: "update", detail: null });
  it("a narrow chart (big minimum gap) merges updates that a wide one keeps apart", () => {
    const events = [update(2 * HOUR), update(4 * HOUR)];
    expect(eventMarkers(events, 0, 20 * HOUR, "hour", HOUR)).toHaveLength(2);      // wide screen
    expect(eventMarkers(events, 0, 20 * HOUR, "hour", 3 * HOUR)).toHaveLength(1);  // phone
  });
  it("on a long daily chart, neighbouring days merge when they'd be too close to tell apart", () => {
    const events = [update(10 * DAY), update(11 * DAY), update(40 * DAY)];
    const markers = eventMarkers(events, 0, 365 * DAY, "day", 5 * DAY);
    expect(markers.map((m) => [m.t / DAY, m.events.length])).toEqual([[10, 2], [40, 1]]);
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
