/**
 * Candlestick chart for the "Call It" game: the stock on top, the S&P 500 below, on a log scale.
 *
 * Both panels use the SAME span in log units (see chartScale.ts) and the same pixel height, so a
 * 10% move is the same size in either one. The past is drawn up to the decision day; the following
 * month is reserved as a shaded "?" zone. Once the call is locked in, the outcome candles appear
 * one day at a time (`shown`) in both panels together.
 *
 * The chart measures its own box and lays the two panels out to fill it, so it uses whatever room
 * the screen gives it instead of scaling a fixed drawing (which would leave dead space on tall
 * windows and shrink the text on small ones). The SVG's viewBox is the box's pixel size.
 *
 * The vertical scale only includes the outcome once the call has been made, so before that the
 * axis cannot hint at where the price is headed. After that it is fixed for the whole
 * animation, so candles are drawn into a stable frame instead of the frame lurching each day.
 */
import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { Candle, Pair } from "@quartr/shared";
import { formatPct, logY, pctTicks, sharedLogDomains, type PriceRange } from "../chartScale";
import { raceAt } from "../game";

type Props = {
  before: Pair;
  sma200: (number | null)[];
  /** The outcome, present once the call is locked in. */
  after?: Pair;
  /** How many outcome candles to draw (0..horizon). */
  shown: number;
  horizon: number;
};

const M = { left: 54, right: 66, top: 22, bottom: 24 };
const GAP = 34;

const rangeOf = (candles: Candle[], extra: number[] = []): PriceRange => {
  let lo = Infinity, hi = -Infinity;
  for (const c of candles) {
    lo = Math.min(lo, c[2]);
    hi = Math.max(hi, c[1]);
  }
  for (const v of extra) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return { lo, hi };
};

const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;

export function CandleChart({ before, sma200, after, shown, horizon }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 760, h: 380 });
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = (w: number, h: number) => setSize({ w: Math.max(320, Math.round(w)), h: Math.max(220, Math.round(h)) });
    measure(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver(([entry]) => entry && measure(entry.contentRect.width, entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = size.w, H = size.h;
  const panelH = Math.max(60, (H - M.top - M.bottom - GAP) / 2);
  const TOP_A = M.top, TOP_B = M.top + panelH + GAP;

  const history = before.stock.length;
  const slots = history + horizon;
  const plotW = W - M.left - M.right;
  const step = plotW / slots;
  const bodyW = Math.max(1.5, step * 0.66);
  const cx = (i: number) => M.left + (i + 0.5) * step;

  const [hover, setHover] = useState<number | null>(null);

  const { domA, domB } = useMemo(() => {
    const smaVals = sma200.filter((v): v is number => v != null);
    const stockRange = rangeOf(after ? [...before.stock, ...after.stock] : before.stock, smaVals);
    const spyRange = rangeOf(after ? [...before.spy, ...after.spy] : before.spy);
    const [a, b] = sharedLogDomains([stockRange, spyRange]);
    return { domA: a!, domB: b! };
  }, [before, sma200, after]);

  const yA = (v: number) => logY(v, domA, TOP_A, panelH);
  const yB = (v: number) => logY(v, domB, TOP_B, panelH);
  const ticksA = pctTicks(domA), ticksB = pctTicks(domB);

  const drawCandles = (candles: Candle[], offset: number, y: (v: number) => number, cls: string) =>
    candles.map(([o, h, l, c], k) => {
      const up = c >= o;
      const x = cx(offset + k);
      const top = y(Math.max(o, c)), bottom = y(Math.min(o, c));
      return (
        <g key={`${cls}-${offset + k}`} className={`${up ? "c-up" : "c-down"} ${cls}`}>
          <line x1={x} x2={x} y1={y(h)} y2={y(l)} className="c-wick" />
          <rect x={x - bodyW / 2} y={top} width={bodyW} height={Math.max(1.4, bottom - top)} className="c-body" />
        </g>
      );
    });

  const smaPath = sma200
    .map((v, k) => (v == null ? null : `${cx(k).toFixed(1)},${yA(v).toFixed(1)}`))
    .filter((p): p is string => p != null)
    .map((p, k) => `${k === 0 ? "M" : "L"}${p}`)
    .join(" ");

  const visibleOutcome = after ? Math.min(shown, horizon) : 0;
  const race = after ? raceAt(after, visibleOutcome) : null;
  const revealed = after != null && visibleOutcome > 0;

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((vx - M.left) / step);
    setHover(i >= 0 && i < history + visibleOutcome ? i : null);
  };

  const tip = hover == null ? null : tooltipFor(hover);
  function tooltipFor(i: number) {
    const future = i >= history;
    const stock = future ? after!.stock[i - history]! : before.stock[i]!;
    const spy = future ? after!.spy[i - history]! : before.spy[i]!;
    const day = future ? `Day +${i - history + 1}` : i === history - 1 ? "Decision day" : `Day ${i - (history - 1)}`;
    return { day, stock, spy, left: cx(i) / W };
  }

  return (
    <div className="chart-wrap">
      <div className="chart-canvas" ref={canvasRef}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="candle-chart"
          role="img"
          aria-label={`Candlestick charts on a log scale: the hidden stock above and the S&P 500 below, ${history} trading days of history${after ? ", and the outcome playing out over the following month" : ". The following month is hidden"}.`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="future-zone" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--violet)" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {[
            { top: TOP_A, ticks: ticksA, y: yA, label: after ? "THE STOCK" : "HIDDEN STOCK" },
            { top: TOP_B, ticks: ticksB, y: yB, label: "S&P 500" },
          ].map((p) => (
            <g key={p.label}>
              <text x={M.left} y={p.top - 7} className="panel-label">{p.label}</text>
              <rect x={M.left} y={p.top} width={plotW} height={panelH} className="panel-bg" rx="6" />
              {p.ticks.map((t) => (
                <g key={t.pct}>
                  <line x1={M.left} x2={W - M.right} y1={p.y(t.price)} y2={p.y(t.price)} className={t.pct === 0 ? "grid-zero" : "grid"} />
                  <text x={M.left - 8} y={p.y(t.price) + 4} textAnchor="end" className="axis">{formatPct(t.pct)}</text>
                </g>
              ))}
              {/* the month being predicted */}
              <rect x={cx(history - 1) + step / 2} y={p.top} width={step * horizon} height={panelH} className="future-zone" />
              {!after && (
                <text
                  x={cx(history - 1) + step / 2 + (step * horizon) / 2}
                  y={p.top + panelH / 2 + Math.min(60, panelH * 0.4) / 3}
                  textAnchor="middle"
                  className="future-q"
                  style={{ fontSize: Math.min(60, panelH * 0.4) }}
                >?</text>
              )}
            </g>
          ))}

          <line x1={cx(history - 1)} x2={cx(history - 1)} y1={TOP_A} y2={TOP_B + panelH} className="decision-line" />

          {smaPath && <path d={smaPath} className="sma-line" fill="none" />}
          {drawCandles(before.stock, 0, yA, "past")}
          {drawCandles(before.spy, 0, yB, "past")}
          {after && drawCandles(after.stock.slice(0, visibleOutcome), history, yA, "future")}
          {after && drawCandles(after.spy.slice(0, visibleOutcome), history, yB, "future")}

          {/* running result tags at the right edge */}
          {revealed && race && (
            <g>
              <text x={W - M.right + 8} y={yA(after!.stock[visibleOutcome - 1]![3]) + 4} className={race.stock >= 0 ? "tag-up" : "tag-down"}>{signed(race.stock)}</text>
              <text x={W - M.right + 8} y={yB(after!.spy[visibleOutcome - 1]![3]) + 4} className={race.spy >= 0 ? "tag-up" : "tag-down"}>{signed(race.spy)}</text>
            </g>
          )}

          {hover != null && <line x1={cx(hover)} x2={cx(hover)} y1={TOP_A} y2={TOP_B + panelH} className="crosshair" />}

          <text x={M.left} y={H - 7} className="axis">{history} trading days ago</text>
          <text x={cx(history - 1)} y={H - 7} textAnchor="middle" className="axis axis-hot">decision day</text>
          <text x={W - M.right} y={H - 7} textAnchor="end" className="axis">+{horizon} days</text>
          <text x={W - M.right + 8} y={TOP_A + 12} className="axis">log scale</text>
        </svg>

        {tip && (
          <div className="chart-tip" style={{ left: `${Math.min(Math.max(tip.left * 100, 14), 86)}%` }}>
            <strong>{tip.day}</strong>
            <span>Stock <em>O {signed(tip.stock[0] - 100)} · H {signed(tip.stock[1] - 100)} · L {signed(tip.stock[2] - 100)} · C {signed(tip.stock[3] - 100)}</em></span>
            <span>S&amp;P&nbsp;500 <em>O {signed(tip.spy[0] - 100)} · H {signed(tip.spy[1] - 100)} · L {signed(tip.spy[2] - 100)} · C {signed(tip.spy[3] - 100)}</em></span>
          </div>
        )}
      </div>

      <ul className="legend">
        <li><span className="swatch up" /> up day</li>
        <li><span className="swatch down" /> down day</li>
        <li><span className="swatch sma" /> stock's 200-day average</li>
        <li className="legend-note">Both panels share one log scale: a 10% move is the same height in each.</li>
      </ul>
    </div>
  );
}
