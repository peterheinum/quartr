import { describe, expect, test } from "bun:test";
import { formMatches, parseForm } from "../src/edgar/forms";

describe("parseForm", () => {
  test("passes ordinary forms through unchanged", () => {
    expect(parseForm("10-K").canonical).toBe("10-K");
    expect(parseForm("8-K").canonical).toBe("8-K");
    expect(parseForm("424B2").canonical).toBe("424B2");
  });

  test("accepts the hyphenless spelling people actually type", () => {
    // The assignment itself writes "10K".
    for (const input of ["10K", "10k", "10 K", "10-k", " 10-K "]) {
      expect(parseForm(input).canonical).toBe("10-K");
    }
    expect(parseForm("10q").canonical).toBe("10-Q");
  });

  test("splits the amendment suffix from the base form", () => {
    const amended = parseForm("10-K/A");
    expect(amended.base).toBe("10-K");
    expect(amended.isAmendment).toBe(true);
    expect(amended.canonical).toBe("10-K/A");

    expect(parseForm("10-K").isAmendment).toBe(false);
  });

  test("aliases the renamed 13D/13G forms onto one canonical spelling", () => {
    // EDGAR relabelled these during the 2024 move to structured XML filings;
    // "SC 13G" covers 1994-2021 and "SCHEDULE 13G" 2025-2026, with no overlap.
    expect(parseForm("SCHEDULE 13G").canonical).toBe("SC 13G");
    expect(parseForm("SCHEDULE 13G/A").canonical).toBe("SC 13G/A");
    expect(parseForm("SCHEDULE 13D").canonical).toBe("SC 13D");
    expect(parseForm("SCHEDULE 13D/A").canonical).toBe("SC 13D/A");
    // The old spelling is already canonical.
    expect(parseForm("SC 13G/A").canonical).toBe("SC 13G/A");
  });

  test("aliases 10-K405 onto 10-K", () => {
    // 10-K405 differed only by a cover-page checkbox. Apple filed an annual
    // report every year 1994-2025, but fiscal 1998 and 2001 were filed as
    // 10-K405 and would otherwise be missing.
    expect(parseForm("10-K405").canonical).toBe("10-K");
  });

  test("does NOT alias the small-business forms onto 10-K", () => {
    // 10-KSB was the annual report under Regulation S-B, a reduced disclosure
    // regime with fewer years of financials. Different requirements means a
    // different document, unlike the 10-K405 checkbox.
    expect(parseForm("10-KSB").canonical).toBe("10-KSB");
    expect(parseForm("10-QSB").canonical).toBe("10-QSB");
    // The 405 variant of the small-business form still folds into 10-KSB.
    expect(parseForm("10-KSB405").canonical).toBe("10-KSB");
  });

  test("does not treat a late-filing notice as an annual report", () => {
    // NT 10-K announces that the 10-K will be late. It is not a 10-K.
    expect(parseForm("NT 10-K").base).not.toBe("10-K");
    expect(parseForm("NT 10-K").canonical).toBe("NT 10-K");
  });

  test("keeps distinct annual reports distinct", () => {
    // 20-F and 40-F are annual reports for foreign and Canadian filers.
    // They answer a different question and must not collapse into 10-K.
    expect(parseForm("20-F").canonical).toBe("20-F");
    expect(parseForm("40-F").canonical).toBe("40-F");
  });

  test("always preserves EDGAR's literal string", () => {
    expect(parseForm("10-K405").raw).toBe("10-K405");
    expect(parseForm("SCHEDULE 13G/A").raw).toBe("SCHEDULE 13G/A");
  });
});

describe("formMatches", () => {
  const tenK = parseForm("10-K");
  const tenKA = parseForm("10-K/A");
  const tenK405 = parseForm("10-K405");
  const tenQ = parseForm("10-Q");

  test("matches on the canonical base form", () => {
    expect(formMatches(tenK, "10-K", false)).toBe(true);
    expect(formMatches(tenK, "10k", false)).toBe(true);
    expect(formMatches(tenK405, "10-K", false)).toBe(true);
    expect(formMatches(tenQ, "10-K", false)).toBe(false);
  });

  test("excludes amendments by default", () => {
    // A 10-K/A shares its reportDate with the 10-K it amends, so including it
    // would report two annual reports for one fiscal year.
    expect(formMatches(tenKA, "10-K", false)).toBe(false);
  });

  test("includes amendments when the caller opts in", () => {
    expect(formMatches(tenKA, "10-K", true)).toBe(true);
    expect(formMatches(tenK, "10-K", true)).toBe(true);
  });

  test("an explicit amendment request returns only amendments", () => {
    expect(formMatches(tenKA, "10-K/A", false)).toBe(true);
    expect(formMatches(tenK, "10-K/A", false)).toBe(false);
  });

  test("the 13G alias works through the filter, in both directions", () => {
    expect(formMatches(parseForm("SCHEDULE 13G"), "SC 13G", false)).toBe(true);
    expect(formMatches(parseForm("SC 13G"), "SCHEDULE 13G", false)).toBe(true);
  });
});
