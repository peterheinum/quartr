import { describe, expect, test } from "bun:test";
import { windowAroundFiling, type Bar } from "../src/prices";

// One bar per calendar day, weekends included, so trading-day offsets are easy to read.
function bars(start: string, n: number, price = (i: number) => 100 + i): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), close: price(i) };
  });
}

describe("windowAroundFiling", () => {
  const b = bars("2025-01-01", 400);

  test("reference is the close strictly before the filing date", () => {
    const w = windowAroundFiling(b, "2025-02-01");
    expect(w.reference?.date).toBe("2025-01-31");
  });

  test("offsets are in bars for +/-5d and in calendar time for +30d / +6m", () => {
    const w = windowAroundFiling(b, "2025-02-01");
    const at = (l: string) => w.points.find((p) => p.label === l)?.date;
    expect(at("-5d")).toBe("2025-01-26");
    expect(at("0d")).toBe("2025-02-01");
    expect(at("+5d")).toBe("2025-02-06");
    expect(at("+30d")).toBe("2025-03-03");
    expect(at("+6m")).toBe("2025-08-01");
  });

  test("filing on a non-trading day rolls to the next bar", () => {
    const sparse = b.filter((x) => x.date !== "2025-02-01");
    const w = windowAroundFiling(sparse, "2025-02-01");
    expect(w.points.find((p) => p.label === "0d")?.date).toBe("2025-02-02");
  });

  test("horizons beyond the data are reported missing, not faked", () => {
    const w = windowAroundFiling(bars("2025-01-01", 70), "2025-02-01");
    expect(w.missing).toEqual(["+6m"]);
    expect(w.points.map((p) => p.label)).toEqual(["-5d", "0d", "+5d", "+30d"]);
  });

  test("return is percent versus the reference close", () => {
    const w = windowAroundFiling(bars("2025-01-01", 400, () => 100), "2025-02-01");
    expect(w.points.every((p) => p.returnPct === 0)).toBe(true);
  });

  test("no bar before the filing means no window", () => {
    expect(windowAroundFiling(b, "2024-06-01").reference).toBeNull();
  });
});
