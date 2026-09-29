/**
 * Log-scale helpers for the candle charts.
 *
 * On a log axis an equal percentage move is an equal distance, so a stock that gains 10% and
 * an index that gains 10% look the same size. Giving every panel the SAME span in log units
 * (each centred on its own prices) makes the panels directly comparable by eye: 10% is the same
 * number of pixels in the stock panel as in the S&P 500 panel.
 */

export type PriceRange = { lo: number; hi: number };

/** Log-price bounds [bottom, top] for a panel. */
export type Domain = [bottom: number, top: number];

/**
 * One domain per range, all with the same height in log units: the tallest panel's span plus padding.
 * Each domain stays centred on its own range, so every range fits inside it.
 */
export function sharedLogDomains(ranges: PriceRange[], pad = 0.07): Domain[] {
  const spans = ranges.map((r) => Math.log(r.hi) - Math.log(r.lo));
  // A dead-flat panel still needs some height to draw in.
  const span = Math.max(...spans, 0.01) * (1 + 2 * pad);
  return ranges.map((r): Domain => {
    const mid = (Math.log(r.hi) + Math.log(r.lo)) / 2;
    return [mid - span / 2, mid + span / 2];
  });
}

/** Pixel y for a price: `top` is the pixel for the top of the domain, `height` the panel height. */
export function logY(price: number, domain: Domain, top: number, height: number): number {
  const [bottom, ceil] = domain;
  return top + (1 - (Math.log(price) - bottom) / (ceil - bottom)) * height;
}

export type Tick = { pct: number; price: number };

const STEPS = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200];

/**
 * Grid lines at round percentage moves from the decision-day price (100), for example -10%, 0, +10%.
 * Picks the smallest step that keeps the count within `maxTicks`.
 */
export function pctTicks(domain: Domain, maxTicks = 6): Tick[] {
  const minPct = (Math.exp(domain[0]) / 100 - 1) * 100;
  const maxPct = (Math.exp(domain[1]) / 100 - 1) * 100;
  for (const step of STEPS) {
    const first = Math.ceil(minPct / step), last = Math.floor(maxPct / step);
    if (last - first + 1 <= maxTicks) {
      const ticks: Tick[] = [];
      for (let k = first; k <= last; k++) {
        const pct = Math.round(k * step * 100) / 100;
        ticks.push({ pct, price: 100 * (1 + pct / 100) });
      }
      return ticks;
    }
  }
  return [];
}

export const formatPct = (p: number) => `${p > 0 ? "+" : ""}${p}%`;
