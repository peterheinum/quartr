import { describe, expect, test } from "bun:test";
import { formatPct, logY, pctTicks, sharedLogDomains } from "../src/chartScale";

describe("sharedLogDomains", () => {
  const ranges = [{ lo: 90, hi: 110 }, { lo: 98, hi: 102 }];
  const domains = sharedLogDomains(ranges);

  test("every panel gets the same height in log units", () => {
    const heights = domains.map(([b, t]) => t - b);
    expect(heights[0]!).toBeCloseTo(heights[1]!, 10);
  });
  test("each domain contains its own range", () => {
    domains.forEach(([b, t], i) => {
      expect(b).toBeLessThan(Math.log(ranges[i]!.lo));
      expect(t).toBeGreaterThan(Math.log(ranges[i]!.hi));
    });
  });
  test("a flat panel still gets some height to draw in", () => {
    const [[b, t]] = sharedLogDomains([{ lo: 100, hi: 100 }]);
    expect(t - b).toBeGreaterThan(0);
  });
  test("equal percentage moves are the same number of pixels in both panels: the point of a shared log span", () => {
    // +10% from 100 in the wide panel and +10% from 100 in the narrow panel
    const tall = (d: [number, number]) => logY(100, d, 0, 200) - logY(110, d, 0, 200);
    expect(tall(domains[0]!)).toBeCloseTo(tall(domains[1]!), 8);
  });
});

describe("logY", () => {
  const d: [number, number] = [Math.log(50), Math.log(200)];
  test("the top of the domain is at `top` and the bottom at `top + height`", () => {
    expect(logY(200, d, 10, 100)).toBeCloseTo(10);
    expect(logY(50, d, 10, 100)).toBeCloseTo(110);
  });
  test("is logarithmic: the geometric mean sits in the middle, the arithmetic mean does not", () => {
    expect(logY(100, d, 0, 100)).toBeCloseTo(50);
    expect(logY(125, d, 0, 100)).not.toBeCloseTo(50);
  });
  test("a doubling and a halving from 100 are equal distances", () => {
    expect(logY(100, d, 0, 100) - logY(200, d, 0, 100)).toBeCloseTo(logY(50, d, 0, 100) - logY(100, d, 0, 100));
  });
});

describe("pctTicks", () => {
  const domain: [number, number] = [Math.log(88), Math.log(115)];
  const ticks = pctTicks(domain);
  test("includes zero (the decision-day price) when it is in view", () => {
    expect(ticks.some((t) => t.pct === 0 && t.price === 100)).toBe(true);
  });
  test("stays inside the domain and within the tick budget", () => {
    expect(ticks.length).toBeLessThanOrEqual(6);
    for (const t of ticks) {
      expect(Math.log(t.price)).toBeGreaterThanOrEqual(domain[0]);
      expect(Math.log(t.price)).toBeLessThanOrEqual(domain[1]);
    }
  });
  test("ticks are round percentage moves from 100", () => {
    for (const t of ticks) expect(t.price).toBeCloseTo(100 * (1 + t.pct / 100), 8);
  });
  test("a wider view picks a coarser step", () => {
    const wide = pctTicks([Math.log(40), Math.log(250)]);
    const gap = (ts: typeof ticks) => ts[1]!.pct - ts[0]!.pct;
    expect(gap(wide)).toBeGreaterThan(gap(ticks));
  });
});

describe("formatPct", () => {
  test("adds a plus sign to gains only", () => {
    expect(formatPct(10)).toBe("+10%");
    expect(formatPct(-5)).toBe("-5%");
    expect(formatPct(0)).toBe("0%");
  });
});
