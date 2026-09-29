/** Small statistics helpers for the analysis scripts. */

export const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

export function pearson(x: number[], y: number[]): number {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  x.forEach((v, i) => {
    sxy += (v - mx) * (y[i]! - my);
    sxx += (v - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  });
  return sxy / Math.sqrt(sxx * syy);
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    if (Math.abs(M[c]![c]!) < 1e-12) throw new Error("singular matrix");
    for (let r = c + 1; r < n; r++) {
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let k = r + 1; k < n; k++) s -= M[r]![k]! * x[k]!;
    x[r] = s / M[r]![r]!;
  }
  return x;
}

export interface Fit {
  /** Intercept first, then one coefficient per predictor. */
  coef: number[];
  r2: number;
  adjR2: number;
  predict: (x: number[]) => number;
}

/** Ordinary least squares of y on the columns of X (intercept added). */
export function ols(X: number[][], y: number[]): Fit {
  const n = y.length, k = X[0]!.length + 1;
  const D = X.map((r) => [1, ...r]);
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => D.reduce((s, r) => s + r[i]! * r[j]!, 0)));
  const Xty = Array.from({ length: k }, (_, i) => D.reduce((s, r, t) => s + r[i]! * y[t]!, 0));
  const coef = solve(XtX, Xty);
  const predict = (x: number[]) => coef[0]! + x.reduce((s, v, i) => s + coef[i + 1]! * v, 0);
  const my = mean(y);
  const ssRes = y.reduce((s, v, i) => s + (v - predict(X[i]!)) ** 2, 0);
  const ssTot = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const r2 = 1 - ssRes / ssTot;
  return { coef, r2, adjR2: 1 - ((1 - r2) * (n - 1)) / (n - k), predict };
}

/**
 * Leave-one-out score: R² of predictions made for each point by a model that never saw it.
 * Above 0 means it beats just guessing the mean; a model that only fits noise goes negative.
 */
export function looR2(X: number[][], y: number[]): number {
  const preds = y.map((_, i) => {
    const keep = y.map((_, j) => j).filter((j) => j !== i);
    return ols(keep.map((j) => X[j]!), keep.map((j) => y[j]!)).predict(X[i]!);
  });
  const my = mean(y);
  const ssRes = y.reduce((s, v, i) => s + (v - preds[i]!) ** 2, 0);
  const ssTot = y.reduce((s, v) => s + (v - my) ** 2, 0);
  return 1 - ssRes / ssTot;
}

const rank = (a: number[]) =>
  a.map((v) => a.filter((u) => u < v).length + (a.filter((u) => u === v).length + 1) / 2);

/** Spearman rank correlation (Pearson on ranks, ties averaged). */
export const spearman = (x: number[], y: number[]) => pearson(rank(x), rank(y));

function lgamma(z: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = z, tmp = z + 5.5;
  tmp -= (z + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const cj of c) ser += cj / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / z);
}

/** Two-sided p-value for a Pearson r over n points, via the t distribution (numerical tail integral). */
export function pValue(r: number, n: number): number {
  if (n < 3 || Math.abs(r) >= 1) return Math.abs(r) >= 1 ? 0 : 1;
  const df = n - 2;
  const t = Math.abs(r * Math.sqrt(df / (1 - r * r)));
  const pdf = (u: number) =>
    (Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2)) / Math.sqrt(df * Math.PI)) * (1 + (u * u) / df) ** (-(df + 1) / 2);
  const hi = Math.max(t + 60, 80), N = 20000, w = (hi - t) / N;
  let area = 0;
  for (let i = 0; i < N; i++) area += pdf(t + (i + 0.5) * w) * w;
  return Math.min(1, 2 * area);
}

/**
 * Mean of `values` with a t-statistic that treats each group (e.g. calendar month) as one
 * observation, so events that share a market shock are not counted as independent evidence.
 */
export function clusteredMean(values: number[], groups: string[]): { mean: number; t: number; clusters: number } {
  const by = new Map<string, number[]>();
  values.forEach((v, i) => by.set(groups[i]!, [...(by.get(groups[i]!) ?? []), v]));
  const means = [...by.values()].map((g) => mean(g));
  const m = mean(means);
  if (means.length < 2) return { mean: mean(values), t: 0, clusters: means.length };
  const sd = Math.sqrt(means.reduce((s, v) => s + (v - m) ** 2, 0) / (means.length - 1));
  return { mean: mean(values), t: sd === 0 ? 0 : m / (sd / Math.sqrt(means.length)), clusters: means.length };
}
