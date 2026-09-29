import { describe, expect, test } from "bun:test";
import { extractStatement, parseFredCsv, rateChange, rateOn, statementUrls } from "../src/fed";

const series = parseFredCsv("observation_date,DFEDTARU\n2022-01-01,0.25\n2022-02-01,.\n2022-03-17,0.5\n2023-03-01,4.75\n");

describe("fed rate", () => {
  test("missing '.' observations are dropped", () => {
    expect(series.map((p) => p.date)).toEqual(["2022-01-01", "2022-03-17", "2023-03-01"]);
  });
  test("rateOn uses the last observation on or before the date", () => {
    expect(rateOn(series, "2022-02-15")).toBe(0.25);
    expect(rateOn(series, "2022-03-17")).toBe(0.5);
    expect(rateOn(series, "2021-01-01")).toBeNull();
  });
  test("rateChange is percentage points over the trailing year", () => {
    expect(rateChange(series, "2023-03-01")).toBeCloseTo(4.5);
    expect(rateChange(series, "2022-03-17")).toBeNull(); // no observation a year earlier
  });
});

describe("fomc statements", () => {
  test("statementUrls keeps 'a.htm', drops 'a1.htm', dedupes and sorts", () => {
    const page = 'x monetary20230322a1.htm monetary20230201a.htm monetary20230322a.htm monetary20230201a.htm';
    expect(statementUrls(page).map((s) => s.date)).toEqual(["2023-02-01", "2023-03-22"]);
  });
  test("extractStatement returns the body and stops before the voting list", () => {
    const html = '<nav>menu</nav><div id="article"><p>Inflation remains elevated.</p><p>Voting for the monetary policy action were A.</p></div>';
    const t = extractStatement(html);
    expect(t).toContain("Inflation remains elevated.");
    expect(t).not.toContain("menu");
    expect(t).not.toContain("Voting");
  });
  test("extractStatement fails loudly on an unexpected page", () => {
    expect(() => extractStatement("<html></html>")).toThrow();
  });
});
