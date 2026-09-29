import { describe, expect, test } from "bun:test";
import type { Company } from "@quartr/shared";
import { summarize, twelveMonthsBefore } from "../src/summary";
import { filing } from "./fixtures";

const apple: Company = { cik: "0000320193", ticker: "AAPL", name: "Apple Inc." };
const asOf = new Date("2026-09-23T00:00:00Z");

describe("twelveMonthsBefore", () => {
  test("returns the same calendar day one year earlier", () => {
    expect(twelveMonthsBefore(new Date("2026-09-23T00:00:00Z"))).toBe("2025-09-23");
  });

  test("handles a leap day without throwing or skipping a year", () => {
    expect(twelveMonthsBefore(new Date("2024-02-29T00:00:00Z"))).toBe("2023-03-01");
  });
});

describe("summarize — 12-month counts", () => {
  const filings = [
    filing("8-K", "2026-09-01"),
    filing("8-K", "2026-01-15"),
    filing("10-K", "2025-10-31"),
    filing("10-Q", "2025-09-23"),   // exactly on the window boundary: included
    filing("8-K", "2025-09-22"),    // one day outside: excluded
    filing("10-K", "2019-10-31"),   // long outside
  ];

  test("counts only filings inside the trailing 12 months", () => {
    const s = summarize(apple, filings, asOf);
    expect(s.totalLast12Months).toBe(4);
    expect(s.window).toEqual({ from: "2025-09-23", to: "2026-09-23" });
  });

  test("the window boundary is inclusive", () => {
    const s = summarize(apple, filings, asOf);
    expect(s.countsByForm.find((f) => f.form === "10-Q")?.count).toBe(1);
  });

  test("groups by form, most frequent first", () => {
    const s = summarize(apple, filings, asOf);
    expect(s.countsByForm).toEqual([
      { form: "8-K", count: 2 },
      { form: "10-K", count: 1 },
      { form: "10-Q", count: 1 },
    ]);
  });

  test("counts the renamed 13G as one form rather than splitting it", () => {
    const s = summarize(apple, [
      filing("SC 13G", "2026-01-01"),
      filing("SCHEDULE 13G", "2026-02-01"),
    ], asOf);
    expect(s.countsByForm).toEqual([{ form: "SC 13G", count: 2 }]);
  });

  test("counts amendments under their own label", () => {
    const s = summarize(apple, [filing("10-K", "2026-01-01"), filing("10-K/A", "2026-02-01")], asOf);
    expect(s.countsByForm).toEqual([
      { form: "10-K", count: 1 },
      { form: "10-K/A", count: 1 },
    ]);
  });
});

describe("summarize — latest annual report", () => {
  test("finds the latest 10-K even when it predates the 12-month window", () => {
    // The counts window is 12 months, but 'latest 10-K' is not time-limited.
    const s = summarize(apple, [filing("10-K", "2019-10-31")], asOf);
    expect(s.latestTenK?.filingDate).toBe("2019-10-31");
    expect(s.totalLast12Months).toBe(0);
  });

  test("picks the most recent of several", () => {
    const s = summarize(apple, [
      filing("10-K", "2023-11-03"),
      filing("10-K", "2025-10-31"),
      filing("10-K", "2024-11-01"),
    ], asOf);
    expect(s.latestTenK?.filingDate).toBe("2025-10-31");
  });

  test("counts a 10-K405 as a 10-K", () => {
    const s = summarize(apple, [filing("10-K405", "2001-12-21")], asOf);
    expect(s.latestTenK?.filingDate).toBe("2001-12-21");
  });

  test("ignores amendments when choosing the latest 10-K", () => {
    // A 10-K/A amends the same fiscal period, so returning it would report the
    // annual report under a filing date that is not the report's own.
    const s = summarize(apple, [
      filing("10-K", "2025-10-31"),
      filing("10-K/A", "2026-01-20"),
    ], asOf);
    expect(s.latestTenK?.filingDate).toBe("2025-10-31");
  });

  test("is null for a company that has never filed a 10-K", () => {
    // Spotify is a foreign private issuer: it files 20-F, never a 10-K.
    const spotify: Company = { cik: "0001639920", ticker: "SPOT", name: "Spotify Technology S.A." };
    const s = summarize(spotify, [filing("20-F", "2026-02-10"), filing("6-K", "2026-03-01")], asOf);
    expect(s.latestTenK).toBeNull();
    expect(s.latestAnnualReport?.form).toBe("20-F");
    expect(s.latestAnnualReport?.filingDate).toBe("2026-02-10");
  });

  test("latestAnnualReport prefers whichever annual form is most recent", () => {
    const s = summarize(apple, [filing("10-K", "2025-10-31"), filing("40-F", "2026-01-01")], asOf);
    expect(s.latestAnnualReport?.form).toBe("40-F");
    expect(s.latestTenK?.form).toBe("10-K");
  });

  test("both are null for a company with no annual report at all", () => {
    const s = summarize(apple, [filing("8-K", "2026-01-01")], asOf);
    expect(s.latestTenK).toBeNull();
    expect(s.latestAnnualReport).toBeNull();
  });

  test("carries a usable link to the report", () => {
    const s = summarize(apple, [filing("10-K", "2025-10-31")], asOf);
    expect(s.latestTenK?.documentUrl).toContain("sec.gov/Archives/edgar/data/");
  });
});
