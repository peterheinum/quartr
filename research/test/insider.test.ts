import { describe, expect, test } from "bun:test";
import type { Bar } from "../src/prices";
import { clusterEvents, forwardReturns, type InsiderRow } from "../src/insider";

const row = (o: Partial<InsiderRow>): InsiderRow => ({
  acc: "a", filed: "2024-01-01", tradeDate: "2024-01-01", cik: "1", ticker: "AAA", insider: "X", rel: "Director",
  title: "", code: "P", shares: 100, value: 1000, plan: false, ...o,
});

describe("clusterEvents", () => {
  test("rows within the gap of the cluster start join it; the next one starts a new event", () => {
    const rows = [
      row({ acc: "1", filed: "2024-01-01", insider: "A" }),
      row({ acc: "2", filed: "2024-02-15", insider: "B" }),
      row({ acc: "3", filed: "2024-03-31", insider: "A" }), // 90 days from start: still in
      row({ acc: "4", filed: "2024-04-02", insider: "C" }), // 92 days: new cluster
    ];
    const ev = clusterEvents(rows, "P");
    expect(ev.map((e) => e.date)).toEqual(["2024-01-01", "2024-04-02"]);
    expect(ev[0]!.insiders).toBe(2);
  });
  test("issuers and codes never mix", () => {
    const rows = [row({ cik: "1" }), row({ cik: "2" }), row({ cik: "1", code: "S" })];
    expect(clusterEvents(rows, "P")).toHaveLength(2);
    expect(clusterEvents(rows, "S")).toHaveLength(1);
  });
  test("average price is total value over total shares, and officer flag is any-of", () => {
    const [e] = clusterEvents([
      row({ acc: "1", shares: 100, value: 1000 }),
      row({ acc: "2", filed: "2024-01-10", shares: 300, value: 6000, rel: "Director,Officer" }),
    ], "P");
    expect(e!.avgPrice).toBeCloseTo(7000 / 400);
    expect(e!.officer).toBe(true);
    expect(e!.value).toBe(7000);
  });
});

const mk = (n: number, f: (i: number) => number): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), close: f(i) }));

describe("forwardReturns", () => {
  const stock = mk(40, (i) => 100 + i), bench = mk(40, () => 100);
  test("enters at the first bar strictly after the filing date", () => {
    const f = forwardReturns(stock, bench, "2024-01-10", [5])!;
    expect(f.entry.date).toBe("2024-01-11");
  });
  test("return and excess are measured from that entry and offsets count bars", () => {
    const f = forwardReturns(stock, bench, "2024-01-10", [5])!;
    // entry index 10 (close 110), +5 bars -> close 115
    expect(f.byOffset[5]!.ret).toBeCloseTo((115 / 110 - 1) * 100);
    expect(f.byOffset[5]!.excess).toBeCloseTo(f.byOffset[5]!.ret); // flat benchmark
  });
  test("offsets beyond the data are null rather than extrapolated", () => {
    expect(forwardReturns(stock, bench, "2024-01-30", [5, 60])!.byOffset[60]).toBeNull();
  });
  test("a filing after the last bar has no forward window", () => {
    expect(forwardReturns(stock, bench, "2025-01-01", [5])).toBeNull();
  });
});

import { isPlausibleTicker, priceMatches } from "../src/insider";
import { clusteredMean } from "../src/stats";

describe("data checks", () => {
  test("priceMatches accepts near prices and clean split factors, rejects a different company", () => {
    expect(priceMatches(50, 52)).toBe(true);
    expect(priceMatches(200, 50)).toBe(true); // 4:1 split since the trade
    expect(priceMatches(10, 100)).toBe(true); // 1:10 reverse split
    expect(priceMatches(37, 100)).toBe(false);
    expect(priceMatches(0, 100)).toBe(false);
  });
  test("isPlausibleTicker rejects free text", () => {
    expect(isPlausibleTicker("AAPL")).toBe(true);
    expect(isPlausibleTicker("BRK-B")).toBe(true);
    expect(isPlausibleTicker("NYSE:")).toBe(false);
    expect(isPlausibleTicker("N/A")).toBe(false);
    expect(isPlausibleTicker("")).toBe(false);
  });
});

describe("clusteredMean", () => {
  test("many events in one month count as one observation", () => {
    // 100 identical events in month A, one opposite event in month B: clusters, not events, set the t-stat.
    const values = [...Array(100).fill(5), -5];
    const groups = [...Array(100).fill("A"), "B"];
    const r = clusteredMean(values, groups);
    expect(r.clusters).toBe(2);
    expect(Math.abs(r.t)).toBeLessThan(1); // 2 clusters can never look significant
  });
  test("a consistent effect across many months gives a large t", () => {
    const groups = Array.from({ length: 24 }, (_, i) => `m${i}`);
    const values = groups.map((_, i) => 2 + (i % 2 ? 0.2 : -0.2));
    expect(clusteredMean(values, groups).t).toBeGreaterThan(10);
  });
});
