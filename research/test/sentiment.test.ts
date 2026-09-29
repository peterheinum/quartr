import { describe, expect, test } from "bun:test";
import { htmlToText, parseDictionary, scoreText, tokenize } from "../src/sentiment";

const csv = [
  "Word,Seq_num,Word Count,Word Proportion,Average Proportion,Std Dev,Doc Count,Negative,Positive,Uncertainty,Litigious,Strong_Modal,Weak_Modal,Constraining,Complexity,Syllables,Source",
  "LOSS,1,1,0,0,0,1,2009,0,0,0,0,0,0,0,1,x",
  "GAIN,2,1,0,0,0,1,0,2009,0,0,0,0,0,0,1,x",
  "MAY,3,1,0,0,0,1,0,0,2009,0,0,2009,0,0,1,x",
  "TAX,4,1,0,0,0,1,0,0,0,0,0,0,0,0,1,x",
].join("\n");
const dict = parseDictionary(csv);

describe("sentiment", () => {
  test("only words with a non-zero category column are kept", () => {
    expect(dict.has("TAX")).toBe(false);
    expect(dict.get("LOSS")?.has("Negative")).toBe(true);
  });

  test("tokenizer is case-insensitive and splits on punctuation", () => {
    expect(tokenize("Loss, gain; net-loss.")).toEqual(["LOSS", "GAIN", "NET", "LOSS"]);
  });

  test("scores are shares of all words and net tone balances pos vs neg", () => {
    const s = scoreText("loss loss gain may tax", dict);
    expect(s.words).toBe(5);
    expect(s.pct.Negative).toBeCloseTo(40);
    expect(s.pct.Positive).toBeCloseTo(20);
    expect(s.netTone).toBeCloseTo(-1 / 3);
    expect(s.top.Negative[0]).toEqual(["LOSS", 2]);
  });

  test("empty text does not divide by zero", () => {
    expect(scoreText("", dict).netTone).toBe(0);
  });

  test("htmlToText strips tags and the hidden ix:header", () => {
    const t = htmlToText("<ix:header>HIDDEN</ix:header><p>a &amp; b</p><div>c&nbsp;d</div>");
    expect(t).not.toContain("HIDDEN");
    expect(t).toContain("a & b");
    expect(t).toContain("c d");
  });

  test("a wrong header is rejected rather than silently mis-scored", () => {
    expect(() => parseDictionary("Word,Foo\nA,1")).toThrow();
  });
});

import { extractItem } from "../src/sentiment";
describe("extractItem", () => {
  const doc = "Item 5.02 Departure of Directors. John Smith resigned as Chief Financial Officer effective May 1, 2024, and the Board appointed Jane Doe as his successor, effective immediately upon his departure. Item 9.01 Financial Statements. (d) Exhibits. SIGNATURES Pursuant to the requirements";
  test("returns the item body up to the next item heading", () => {
    const s = extractItem(doc, "5.02")!;
    expect(s).toContain("resigned as Chief Financial Officer");
    expect(s).not.toContain("Exhibits");
  });
  test("null when the item is absent", () => {
    expect(extractItem("Item 7.01 Regulation FD. Nothing here that matters much at all in this short filing text.", "5.02")).toBeNull();
  });
});
