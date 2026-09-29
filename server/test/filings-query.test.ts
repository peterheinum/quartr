import { describe, expect, test } from "bun:test";
import { queryFilings, type FilingsQuery } from "../src/filings-query";
import { filing } from "./fixtures";

const defaults: FilingsQuery = {
  forms: [], includeAmendments: false, sort: "desc",
  page: 1, pageSize: 25, from: null, to: null,
};
const q = (overrides: Partial<FilingsQuery> = {}): FilingsQuery => ({ ...defaults, ...overrides });

const filings = [
  filing("10-K", "2025-10-31"),
  filing("10-Q", "2025-08-01"),
  filing("8-K", "2025-05-02"),
  filing("10-K/A", "2024-03-15"),
  filing("10-K405", "2001-12-21"),
  filing("SCHEDULE 13G", "2025-08-08"),
  filing("SC 13G", "2019-02-14"),
  filing("NT 10-K", "2020-01-02"),
];

describe("queryFilings — filtering", () => {
  test("no form filter returns everything except amendments", () => {
    const { total } = queryFilings(filings, q());
    expect(total).toBe(filings.length - 1); // the 10-K/A is excluded
  });

  test("filters by canonical form, folding in retired variants", () => {
    const { filings: rows, total } = queryFilings(filings, q({ forms: ["10-K"] }));
    expect(total).toBe(2); // 10-K and 10-K405, not the 10-K/A
    expect(rows.map((r) => r.rawForm).sort()).toEqual(["10-K", "10-K405"]);
  });

  test("does not mistake a late-filing notice for an annual report", () => {
    const { filings: rows } = queryFilings(filings, q({ forms: ["10-K"] }));
    expect(rows.some((r) => r.rawForm === "NT 10-K")).toBe(false);
  });

  test("the 13G rename is filtered as one form", () => {
    const { total } = queryFilings(filings, q({ forms: ["SC 13G"] }));
    expect(total).toBe(2);
    // ...and the other spelling reaches the same rows.
    expect(queryFilings(filings, q({ forms: ["SCHEDULE 13G"] })).total).toBe(2);
  });

  test("accepts several forms at once", () => {
    const { total } = queryFilings(filings, q({ forms: ["10-K", "8-K"] }));
    expect(total).toBe(3); // 10-K, 10-K405, 8-K
  });

  test("includes amendments only when asked", () => {
    expect(queryFilings(filings, q({ forms: ["10-K"] })).total).toBe(2);
    expect(queryFilings(filings, q({ forms: ["10-K"], includeAmendments: true })).total).toBe(3);
  });

  test("filters by inclusive date range", () => {
    const { total } = queryFilings(filings, q({ from: "2025-01-01", to: "2025-08-08" }));
    expect(total).toBe(3); // 10-Q, 8-K, SCHEDULE 13G — boundary dates included
  });
});

describe("queryFilings — sorting and pagination", () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    filing("8-K", `2025-01-${String(i + 1).padStart(2, "0")}`),
  );

  test("defaults to newest first", () => {
    const { filings: rows } = queryFilings(many, q());
    expect(rows[0]!.filingDate).toBe("2025-01-10");
    expect(rows.at(-1)!.filingDate).toBe("2025-01-01");
  });

  test("sort=asc reverses the order", () => {
    const { filings: rows } = queryFilings(many, q({ sort: "asc" }));
    expect(rows[0]!.filingDate).toBe("2025-01-01");
  });

  test("reports total and totalPages independent of the page returned", () => {
    const result = queryFilings(many, q({ pageSize: 3, page: 2 }));
    expect(result.total).toBe(10);
    expect(result.totalPages).toBe(4);
    expect(result.filings).toHaveLength(3);
  });

  test("pages partition the results with no gaps or repeats", () => {
    const seen: string[] = [];
    for (let page = 1; page <= 4; page++) {
      seen.push(...queryFilings(many, q({ pageSize: 3, page })).filings.map((f) => f.accessionNumber));
    }
    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
  });

  test("a page past the end is empty rather than an error", () => {
    const result = queryFilings(many, q({ pageSize: 3, page: 99 }));
    expect(result.filings).toEqual([]);
    expect(result.total).toBe(10);
  });

  test("ties on filing date are ordered stably by accession number", () => {
    const sameDay = [
      filing("8-K", "2025-01-01", { accessionNumber: "0000000000-25-000002" }),
      filing("8-K", "2025-01-01", { accessionNumber: "0000000000-25-000001" }),
    ];
    const once = queryFilings(sameDay, q()).filings.map((f) => f.accessionNumber);
    const twice = queryFilings([...sameDay].reverse(), q()).filings.map((f) => f.accessionNumber);
    expect(once).toEqual(twice);
  });

  test("an empty totalPages is 1, not 0, so page 1 is always valid", () => {
    expect(queryFilings([], q()).totalPages).toBe(1);
  });
});

describe("queryFilings — availableForms", () => {
  test("lists the forms this company filed, most frequent first", () => {
    const rows = [filing("8-K", "2025-01-01"), filing("8-K", "2025-01-02"), filing("10-K", "2025-01-03")];
    expect(queryFilings(rows, q()).availableForms).toEqual([
      { form: "8-K", count: 2 },
      { form: "10-K", count: 1 },
    ]);
  });

  test("is not narrowed by the current form filter", () => {
    // Otherwise picking "10-K" would collapse the dropdown to a single option.
    const result = queryFilings(filings, q({ forms: ["10-K"] }));
    expect(result.availableForms.length).toBeGreaterThan(1);
  });

  test("counts the renamed 13G under one canonical label", () => {
    const forms = queryFilings(filings, q()).availableForms;
    expect(forms.find((f) => f.form === "SC 13G")?.count).toBe(2);
    expect(forms.find((f) => f.form === "SCHEDULE 13G")).toBeUndefined();
  });
});
