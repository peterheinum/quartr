import { describe, expect, test } from "bun:test";
import type { Bar } from "../src/prices";
import { buildPriceWindow, candleOf, describeFed, describeMoney, describeTrend, insiderBot, smaAt, toneBot, trendBot, turnoverBot } from "../src/game";

/** One bar per calendar day from 2020-01-01, so index and date are easy to relate. Flat candles unless given. */
function series(n: number, close: (i: number) => number): Bar[] {
  return Array.from({ length: n }, (_, i) => ({ date: dateAt(i), close: close(i) }));
}
const dateAt = (i: number) => new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);

describe("smaAt", () => {
  test("averages the window ending at i and needs a full window", () => {
    expect(smaAt([1, 2, 3, 4, 5], 4, 3)).toBe(4);
    expect(smaAt([1, 2, 3, 4, 5], 1, 3)).toBeNull();
  });
});

describe("candleOf", () => {
  test("rebases open, high, low and close so the base close is 100", () => {
    const b: Bar = { date: "x", open: 98, high: 104, low: 97, close: 102 };
    expect(candleOf(b, 100)).toEqual([98, 104, 97, 102]);
    expect(candleOf(b, 50)).toEqual([196, 208, 194, 204]);
  });
  test("a bar with no open/high/low degrades to a flat candle at its close", () => {
    expect(candleOf({ date: "x", close: 50 }, 100)).toEqual([50, 50, 50, 50]);
  });
});

describe("buildPriceWindow", () => {
  const spy = series(400, () => 100);

  test("the decision day is the last bar on or before the event date, and closes at exactly 100", () => {
    const w = buildPriceWindow(series(400, (i) => 50 + i), spy, dateAt(300))!;
    expect(w.decisionDate).toBe(dateAt(300));
    expect(w.before.stock.at(-1)![3]).toBe(100);
    expect(w.before.spy.at(-1)![3]).toBe(100);
    expect(w.before.stock).toHaveLength(90);
    expect(w.before.spy).toHaveLength(90);
    expect(w.after.stock).toHaveLength(21);
    expect(w.after.spy).toHaveLength(21);
    expect(w.sma200).toHaveLength(90);
  });

  test("the stock and the S&P 500 are each rebased to their own decision-day close", () => {
    const stock = series(400, () => 40);
    const bench = series(400, () => 500);
    const w = buildPriceWindow(stock, bench, dateAt(300))!;
    expect(w.before.stock.at(-1)![3]).toBe(100);
    expect(w.before.spy.at(-1)![3]).toBe(100);
    expect(w.after.spy.every((c) => c[3] === 100)).toBe(true);
  });

  test("an event on a non-trading day uses the previous close", () => {
    const skip = (bars: Bar[]) => bars.filter((b) => b.date !== dateAt(300));
    const w = buildPriceWindow(skip(series(400, (i) => 50 + i)), skip(spy), dateAt(300))!;
    expect(w.decisionDate).toBe(dateAt(299));
  });

  test("nothing shown before the decision depends on later prices", () => {
    const a = series(400, (i) => 100 + Math.sin(i / 7) * 5);
    const b = a.map((bar, i) => (i > 300 ? { ...bar, close: bar.close * 3 } : bar)); // rewrite the future
    const spyB = spy.map((bar, i) => (i > 300 ? { ...bar, close: 250 } : bar));
    const wa = buildPriceWindow(a, spy, dateAt(300))!, wb = buildPriceWindow(b, spyB, dateAt(300))!;
    expect(wb.before).toEqual(wa.before);
    expect(wb.sma200).toEqual(wa.sma200);
    expect(wb.distFromSma).toBe(wa.distFromSma);
    expect(wb.after.stock).not.toEqual(wa.after.stock); // only the hidden part changed
  });

  test("candles keep their high and low around their open and close after rebasing", () => {
    const bars: Bar[] = Array.from({ length: 400 }, (_, i) => ({ date: dateAt(i), open: 100 + i, high: 105 + i, low: 96 + i, close: 102 + i }));
    const spyBars: Bar[] = Array.from({ length: 400 }, (_, i) => ({ date: dateAt(i), open: 200, high: 203, low: 197, close: 201 }));
    const w = buildPriceWindow(bars, spyBars, dateAt(300))!;
    for (const c of [...w.before.stock, ...w.after.stock, ...w.before.spy, ...w.after.spy]) {
      expect(c[1]).toBeGreaterThanOrEqual(Math.max(c[0], c[3]));
      expect(c[2]).toBeLessThanOrEqual(Math.min(c[0], c[3]));
    }
  });

  test("answer compares the stock's return with the benchmark's over the horizon", () => {
    expect(buildPriceWindow(series(400, (i) => 100 + i), series(400, () => 100), dateAt(300))!.answer).toBe("beat");
    expect(buildPriceWindow(series(400, () => 100), series(400, (i) => 100 + i), dateAt(300))!.answer).toBe("lag");
  });

  test("excess is the stock return minus the benchmark return in percent", () => {
    const stock = series(400, (i) => (i <= 300 ? 100 : 110)); // +10% by the horizon
    const bench = series(400, (i) => (i <= 300 ? 100 : 104)); // +4%
    expect(buildPriceWindow(stock, bench, dateAt(300))!.excess).toBeCloseTo(6);
  });

  test("distance from the SMA is positive in an uptrend and negative in a downtrend", () => {
    expect(buildPriceWindow(series(400, (i) => 100 + i), spy, dateAt(300))!.distFromSma).toBeGreaterThan(0);
    expect(buildPriceWindow(series(400, (i) => 500 - i), spy, dateAt(300))!.distFromSma).toBeLessThan(0);
  });

  test("null when there is too little history, too little future, or the benchmark is missing a day", () => {
    const bars = series(400, (i) => 100 + i);
    expect(buildPriceWindow(bars, spy, dateAt(100))).toBeNull(); // under 200 bars of history
    expect(buildPriceWindow(bars, spy, dateAt(395))).toBeNull(); // horizon runs off the end
    expect(buildPriceWindow(bars, spy.filter((b) => b.date !== dateAt(250)), dateAt(300))).toBeNull(); // a gap in the history window
    expect(buildPriceWindow(bars, spy.filter((b) => b.date !== dateAt(305)), dateAt(300))).toBeNull(); // a gap in the future window
  });
});

describe("signal rules", () => {
  test("trend: above the 200-day average calls beat", () => {
    expect(trendBot(5)).toBe("beat");
    expect(trendBot(-5)).toBe("lag");
  });
  test("tone: more positive than usual calls beat", () => {
    expect(toneBot(0.4)).toBe("beat");
    expect(toneBot(-0.4)).toBe("lag");
  });
  test("insider: buys beat, sells lag", () => {
    expect(insiderBot("P")).toBe("beat");
    expect(insiderBot("S")).toBe("lag");
  });
  test("turnover: any top executive leaving calls lag, otherwise beat", () => {
    const none = { ceoOut: false, ceoIn: false, cfoOut: false, cfoIn: false, officerOut: false, officerIn: false, directorOut: false, directorIn: false };
    expect(turnoverBot({ ...none, ceoOut: true })).toBe("lag");
    expect(turnoverBot({ ...none, cfoOut: true, cfoIn: true })).toBe("lag");
    expect(turnoverBot({ ...none, ceoIn: true })).toBe("beat");
  });
});

describe("wording never names anything", () => {
  test("trend", () => {
    expect(describeTrend(12.4)).toBe("12% above its 200-day average");
    expect(describeTrend(-20.6)).toBe("21% below its 200-day average");
    expect(describeTrend(0.3)).toBe("about at its 200-day average");
  });
  test("Fed regime", () => {
    expect(describeFed(5.5, 2.25)).toContain("raising rates");
    expect(describeFed(0.25, 0)).toContain("holding rates");
    expect(describeFed(3, -1)).toContain("cutting rates");
  });
  test("money", () => {
    expect(describeMoney(2_500_000)).toBe("$2.5M");
    expect(describeMoney(420_000)).toBe("$420k");
  });
});
