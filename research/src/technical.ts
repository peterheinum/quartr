/** Technical indicators over daily bars (ascending by date). */
import type { Bar } from "./prices";

/** Simple moving average of the `period` closes ending at `endIndex` (inclusive). Null if not enough history. */
export function sma(bars: Bar[], endIndex: number, period: number): number | null {
  if (endIndex < period - 1 || endIndex >= bars.length) return null;
  let sum = 0;
  for (let i = endIndex - period + 1; i <= endIndex; i++) sum += bars[i]!.close;
  return sum / period;
}

/**
 * How far the close on `date` sits above (+) or below (-) its own SMA, in percent.
 * Uses only bars up to and including `date`, so it is knowable at that point.
 */
export function distanceFromSma(bars: Bar[], date: string, period = 200): number | null {
  const i = bars.findIndex((b) => b.date === date);
  if (i < 0) return null;
  const avg = sma(bars, i, period);
  return avg == null ? null : ((bars[i]!.close - avg) / avg) * 100;
}
