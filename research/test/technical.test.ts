import { describe, expect, test } from "bun:test";
import type { Bar } from "../src/prices";
import { distanceFromSma, sma } from "../src/technical";
import { looR2, ols, pearson } from "../src/stats";

const mk = (closes: number[]): Bar[] => closes.map((close, i) => ({ date: `2025-01-${String(i + 1).padStart(2, "0")}`, close }));

describe("sma", () => {
  test("averages the window ending at the index, inclusive", () => {
    expect(sma(mk([1, 2, 3, 4, 5]), 4, 3)).toBe(4);
    expect(sma(mk([1, 2, 3, 4, 5]), 2, 3)).toBe(2);
  });
  test("returns null without enough history rather than a partial average", () => {
    expect(sma(mk([1, 2, 3]), 1, 3)).toBeNull();
  });
  test("distance is percent above/below the average and ignores later bars", () => {
    const bars = mk([10, 10, 10, 20, 999]);
    // SMA3 ending at index 3 = (10+10+20)/3 = 13.33; close 20 -> +50%
    expect(distanceFromSma(bars, "2025-01-04", 3)).toBeCloseTo(50);
    expect(distanceFromSma(bars, "2025-01-02", 3)).toBeNull();
    expect(distanceFromSma(bars, "1999-01-01", 3)).toBeNull();
  });
});

describe("stats", () => {
  test("pearson of a perfect line is 1, of its negation -1", () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1);
  });
  test("ols recovers known coefficients", () => {
    const X = [[1, 0], [2, 1], [3, 0], [4, 2], [5, 1]];
    const y = X.map(([a, b]) => 3 + 2 * a! - 1 * b!);
    const f = ols(X, y);
    expect(f.coef[0]).toBeCloseTo(3);
    expect(f.coef[1]).toBeCloseTo(2);
    expect(f.coef[2]).toBeCloseTo(-1);
    expect(f.r2).toBeCloseTo(1);
  });
  test("leave-one-out is high for real signal and negative for noise", () => {
    const x = Array.from({ length: 12 }, (_, i) => [i]);
    expect(looR2(x, x.map(([v]) => 2 * v! + 1))).toBeGreaterThan(0.99);
    const noise = [3, -2, 5, -4, 1, -3, 4, -1, 2, -5, 0, 6];
    expect(looR2(x, noise)).toBeLessThan(0);
  });
});

import { pValue, spearman } from "../src/stats";
describe("stats p-values", () => {
  test("pValue matches known t-table values", () => {
    // r=0.5, n=12 -> t=1.826, df=10 -> two-sided p ~= 0.098
    expect(pValue(0.5, 12)).toBeCloseTo(0.098, 2);
    // r=0.7071, n=8 -> t=2.449, df=6 -> p ~= 0.0499
    expect(pValue(0.7071, 8)).toBeCloseTo(0.05, 2);
    expect(pValue(0, 20)).toBeCloseTo(1, 2);
  });
  test("spearman is rank based and handles ties", () => {
    expect(spearman([1, 2, 3, 4], [1, 4, 9, 100])).toBeCloseTo(1);
    expect(spearman([1, 1, 2], [5, 5, 9])).toBeCloseTo(1);
  });
});
