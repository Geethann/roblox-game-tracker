// Tests for comparing games: reading the address, colours, % change, and CSV safety.
import { describe, expect, it } from "vitest";
import { assignSlots, mergeSeries, parseIds, playersVsMain, ratingVsMain, toCompareCsv } from "./compare.js";

describe("parseIds", () => {
  it("keeps only digits, removes repeats, and caps the number of games", () => {
    expect(parseIds("123,abc,456,123,7,8,9,10")).toEqual([123, 456, 7, 8]);
  });
  it("never includes the main game twice", () => {
    expect(parseIds("1,2,3", { without: 2 })).toEqual([1, 3]);
  });
  it("copes with an empty address", () => {
    expect(parseIds(null)).toEqual([]);
  });
});

describe("assignSlots (each game keeps its colour)", () => {
  it("gives new games the first free colours in order", () => {
    expect([...assignSlots(new Map(), [10, 20, 30]).values()]).toEqual([1, 2, 3]);
  });

  it("doesn't repaint the other games when one is removed", () => {
    const before = assignSlots(new Map(), [10, 20, 30]);
    const after = assignSlots(before, [10, 30]);
    expect(after.get(10)).toBe(1);
    expect(after.get(30)).toBe(3); // still 3, not shuffled down to 2
  });

  it("gives a newly added game the colour that was freed up", () => {
    const after = assignSlots(assignSlots(new Map(), [10, 20, 30]), [10, 30, 40]);
    expect(after.get(40)).toBe(2);
  });
});

describe("mergeSeries", () => {
  const series = [
    { id: 1, points: [{ t: 0, playing: 100 }, { t: 1, playing: 150 }] },
    { id: 2, points: [{ t: 0, playing: 1000 }, { t: 1, playing: 900 }] },
  ];
  const players = (p) => p.playing;

  it("lines readings up by time, one column per game (plus the line each game draws)", () => {
    expect(mergeSeries(series, players, "actual")).toEqual([
      { t: 0, 1: 100, 2: 1000, "line-1": 100, "line-2": 1000 },
      { t: 1, 1: 150, 2: 900, "line-1": 150, "line-2": 900 },
    ]);
  });

  it("in % change mode, starts every game at 0%", () => {
    const rows = mergeSeries(series, players, "percent");
    expect(rows[0]).toMatchObject({ t: 0, 1: 0, 2: 0 });
    expect(rows[1][1]).toBeCloseTo(0.5);
    expect(rows[1][2]).toBeCloseTo(-0.1);
  });

  const HOUR = 3600;
  const at = (hours) => hours.map(([h, playing]) => ({ t: h * HOUR, playing }));

  it("draws across a game's missed reading, but never shows a made-up number for it", () => {
    const rows = mergeSeries([
      { id: 1, points: at([[0, 100], [2, 300]]) },             // missed hour 1
      { id: 2, points: at([[0, 10], [1, 20], [2, 30]]) },
    ], players, "actual");
    expect(rows[1][1]).toBeUndefined();  // the hover box, table and CSV show nothing for game 1 at hour 1
    expect(rows[1]["line-1"]).toBe(200); // but its line is joined straight across
  });

  it("breaks a game's line across a long gap", () => {
    const rows = mergeSeries([
      { id: 1, points: at([[0, 100], [6, 300]]) },             // 5 hours missing
      { id: 2, points: at([[0, 10], [1, 11], [2, 12], [3, 13], [4, 14], [5, 15], [6, 16]]) },
    ], players, "actual");
    expect(rows.slice(1, 6).map((row) => row["line-1"])).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("adds an empty row where no game has readings (an outage), so every line breaks", () => {
    const rows = mergeSeries([{ id: 1, points: at([[0, 100], [10, 200]]) }], players, "actual");
    expect(rows.map((row) => row.t)).toEqual([0, HOUR, 10 * HOUR]);
    expect(rows[1]).toEqual({ t: HOUR, gap: true });
    expect(toCompareCsv(rows, [{ universeId: 1, name: "A" }], "hour").split("\n")).toHaveLength(3); // header + 2 real rows
  });
});

describe("vs main", () => {
  it("shows how many times main's players", () => {
    expect(playersVsMain(300, 100)).toBe("3.0×");
    expect(playersVsMain(48, 100)).toBe("0.48×");
    expect(playersVsMain(5000, 100)).toBe("50×");
    expect(playersVsMain(100, 0)).toBe("—"); // can't divide by an empty game
  });

  it("shows rating differences in percentage points", () => {
    expect(ratingVsMain(0.92, 0.9)).toBe("+2 pts");
    expect(ratingVsMain(0.874, 0.9)).toBe("-2.6 pts");
    expect(ratingVsMain(0.9, 0.9)).toBe("Same");
  });
});

describe("toCompareCsv", () => {
  it("quotes names with commas and quotes", () => {
    const csv = toCompareCsv([], [{ universeId: 1, name: 'Say "hi", world' }], "hour");
    expect(csv).toBe('time_utc,"Say ""hi"", world"');
  });

  it("stops a game name running as a spreadsheet formula (CSV injection)", () => {
    const csv = toCompareCsv([], [{ universeId: 1, name: "=HYPERLINK(\"http://evil\")" }], "hour");
    expect(csv).toContain("\"'=HYPERLINK");
  });
});
