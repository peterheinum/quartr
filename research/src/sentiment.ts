/**
 * Loughran-McDonald dictionary sentiment for filings.
 *
 * Bag of words: count the words that belong to each category and divide by the
 * total words. No context, so "we do not expect a loss" still counts "loss".
 */
import { readFileSync } from "node:fs";

export const CATEGORIES = ["Negative", "Positive", "Uncertainty", "Litigious", "Constraining"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Dictionary = Map<string, Set<Category>>;

/** Master dictionary CSV. A category column holds the year a word was added, 0 if not a member. */
export function parseDictionary(csv: string): Dictionary {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  const header = lines[0]!.split(",");
  const col = (name: string) => header.indexOf(name);
  const cols = CATEGORIES.map((c) => [c, col(c)] as const);
  if (cols.some(([, i]) => i < 0) || col("Word") !== 0) throw new Error("unexpected dictionary header");
  const dict: Dictionary = new Map();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const f = line.split(",");
    const cats = new Set<Category>();
    for (const [c, i] of cols) if (f[i] !== "0") cats.add(c);
    if (cats.size) dict.set(f[0]!, cats);
  }
  return dict;
}

export function loadDictionary(path = ".data/lm/master.csv"): Dictionary {
  return parseDictionary(readFileSync(path, "utf8"));
}

export function tokenize(text: string): string[] {
  return text.toUpperCase().match(/[A-Z]+/g) ?? [];
}

export interface Score {
  words: number;
  /** Category -> share of all words, in percent. */
  pct: Record<Category, number>;
  /** (positive - negative) / (positive + negative), in [-1, 1]. */
  netTone: number;
  /** Most frequent dictionary hits, for explaining a score. */
  top: Record<"Negative" | "Positive", [string, number][]>;
}

export function scoreText(text: string, dict: Dictionary): Score {
  const tokens = tokenize(text);
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  const hits = { Negative: new Map<string, number>(), Positive: new Map<string, number>() };
  for (const t of tokens) {
    const cats = dict.get(t);
    if (!cats) continue;
    for (const c of cats) counts[c]++;
    if (cats.has("Negative")) hits.Negative.set(t, (hits.Negative.get(t) ?? 0) + 1);
    if (cats.has("Positive")) hits.Positive.set(t, (hits.Positive.get(t) ?? 0) + 1);
  }
  const words = tokens.length;
  const pct = Object.fromEntries(CATEGORIES.map((c) => [c, words ? (counts[c] / words) * 100 : 0])) as Record<Category, number>;
  const denom = counts.Positive + counts.Negative;
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return {
    words,
    pct,
    netTone: denom ? (counts.Positive - counts.Negative) / denom : 0,
    top: { Negative: top(hits.Negative), Positive: top(hits.Positive) },
  };
}

/** Inline-XBRL HTML -> plain text. Drops scripts, styles and the hidden ix:header block. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|ix:header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ");
}

/**
 * The body of one numbered 8-K item (e.g. "5.02"): from its heading up to the next item heading
 * or the signature block. Returns null when the item heading is not found.
 */
export function extractItem(text: string, item: string, maxChars = 8000): string | null {
  const flat = text.replace(/\s+/g, " ");
  const start = new RegExp(`Item\\s+${item.replace(".", "\\.")}\\b`, "gi");
  let best: string | null = null;
  for (let m = start.exec(flat); m; m = start.exec(flat)) {
    const rest = flat.slice(m.index);
    const end = rest.slice(10).search(/Item\s+\d\.\d\d\b|SIGNATURES?\b/i);
    const body = (end < 0 ? rest : rest.slice(0, end + 10)).slice(0, maxChars);
    // Skip a table-of-contents style hit: a real section has some substance.
    if (body.length > 120) { best = body; break; }
  }
  return best;
}
