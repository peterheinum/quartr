import { describe, expect, test } from "bun:test";
import { DEFAULT_QUERY, parseQuery, serializeQuery, type AppQuery } from "../src/urlState";

const q = (overrides: Partial<AppQuery> = {}): AppQuery => ({ ...DEFAULT_QUERY, ...overrides });

describe("parseQuery", () => {
  test("an empty query string yields the defaults", () => {
    expect(parseQuery("")).toEqual(DEFAULT_QUERY);
  });

  test("reads every parameter", () => {
    expect(parseQuery("?ticker=SPOT&form=20-F,6-K&sort=asc&page=3&amendments=1")).toEqual(
      q({ ticker: "SPOT", forms: ["20-F", "6-K"], sort: "asc", page: 3, includeAmendments: true }),
    );
  });

  test("uppercases and trims tickers and forms", () => {
    const parsed = parseQuery("?ticker=%20spot%20&form=20-f,%206-k");
    expect(parsed.ticker).toBe("SPOT");
    expect(parsed.forms).toEqual(["20-F", "6-K"]);
  });

  test("accepts either spelling of the amendments flag", () => {
    expect(parseQuery("?amendments=1").includeAmendments).toBe(true);
    expect(parseQuery("?amendments=true").includeAmendments).toBe(true);
    expect(parseQuery("?amendments=0").includeAmendments).toBe(false);
  });

  test("falls back to defaults on malformed input rather than throwing", () => {
    // A URL is user input; a bad one should still render the app.
    expect(parseQuery("?sort=sideways").sort).toBe("desc");
    expect(parseQuery("?page=0").page).toBe(1);
    expect(parseQuery("?page=-4").page).toBe(1);
    expect(parseQuery("?page=abc").page).toBe(1);
    expect(parseQuery("?page=1.5").page).toBe(1);
    expect(parseQuery("?ticker=").ticker).toBe(DEFAULT_QUERY.ticker);
  });

  test("distinguishes an absent summary from an explicitly empty one", () => {
    expect(parseQuery("").summaryTickers).toEqual(DEFAULT_QUERY.summaryTickers);
    expect(parseQuery("?summary=").summaryTickers).toEqual([]);
    expect(parseQuery("?summary=MSFT,SHOP").summaryTickers).toEqual(["MSFT", "SHOP"]);
  });

  test("ignores parameters it does not know", () => {
    expect(parseQuery("?utm_source=slack&ticker=JPM").ticker).toBe("JPM");
  });
});

describe("serializeQuery", () => {
  test("omits everything at its default, so the common case is a clean URL", () => {
    expect(serializeQuery(DEFAULT_QUERY)).toBe("");
  });

  test("includes only what differs from the default", () => {
    expect(serializeQuery(q({ ticker: "SPOT" }))).toBe("?ticker=SPOT");
    expect(serializeQuery(q({ page: 4 }))).toBe("?page=4");
    expect(serializeQuery(q({ sort: "asc" }))).toBe("?sort=asc");
    expect(serializeQuery(q({ includeAmendments: true }))).toBe("?amendments=1");
  });

  test("encodes form types that contain spaces", () => {
    // "SC 13G" must survive the round trip.
    const search = serializeQuery(q({ forms: ["SC 13G"] }));
    expect(parseQuery(search).forms).toEqual(["SC 13G"]);
  });

  test("serialises an emptied summary explicitly, not by omission", () => {
    // Omitting it would resurrect the defaults on reload.
    const search = serializeQuery(q({ summaryTickers: [] }));
    expect(search).toBe("?summary=");
    expect(parseQuery(search).summaryTickers).toEqual([]);
  });

  test("leaves the summary out when it matches the default, order included", () => {
    expect(serializeQuery(q({ summaryTickers: ["AAPL", "SPOT", "JPM"] }))).toBe("");
    expect(serializeQuery(q({ summaryTickers: ["JPM", "SPOT", "AAPL"] }))).not.toBe("");
  });
});

describe("round trip", () => {
  const cases: AppQuery[] = [
    DEFAULT_QUERY,
    q({ ticker: "SPOT", forms: ["20-F"], sort: "asc", page: 7 }),
    q({ ticker: "JPM", forms: ["424B2", "SC 13G/A"], includeAmendments: true }),
    q({ summaryTickers: [] }),
    q({ summaryTickers: ["SHOP"] }),
  ];

  test("parse(serialize(x)) === x for every combination", () => {
    for (const state of cases) {
      expect(parseQuery(serializeQuery(state))).toEqual(state);
    }
  });
});
