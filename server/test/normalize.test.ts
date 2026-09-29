import { describe, expect, test } from "bun:test";
import { normalizeFilings, type FilingsColumns } from "../src/edgar/normalize";

/** A two-row columnar block shaped exactly like EDGAR's, with real values. */
function columns(overrides: Partial<FilingsColumns> = {}): FilingsColumns {
  return {
    accessionNumber: ["0000320193-25-000079", "0001047469-98-001822"],
    filingDate: ["2025-10-31", "1998-01-23"],
    reportDate: ["2025-09-27", "1997-09-26"],
    acceptanceDateTime: ["2025-10-31T18:04:28.000Z", ""],
    act: ["34", ""],
    form: ["10-K", "10-K/A"],
    fileNumber: ["001-36743", ""],
    filmNumber: ["251100000", ""],
    items: ["", ""],
    size: [8_000_000, 12_345],
    isXBRL: [1, 0],
    isInlineXBRL: [1, 0],
    // The 1998 filing predates EDGAR tracking a primary document.
    primaryDocument: ["aapl-20250927.htm", ""],
    primaryDocDescription: ["10-K", ""],
    ...overrides,
  };
}

describe("normalizeFilings", () => {
  test("turns parallel arrays into one object per row", () => {
    const rows = normalizeFilings("0000320193", columns());
    expect(rows).toHaveLength(2);
    expect(rows[0]!.accessionNumber).toBe("0000320193-25-000079");
    expect(rows[0]!.filingDate).toBe("2025-10-31");
    expect(rows[1]!.accessionNumber).toBe("0001047469-98-001822");
    expect(rows[1]!.filingDate).toBe("1998-01-23");
  });

  test("builds the document URL from the un-padded CIK and de-hyphenated accession number", () => {
    const [first] = normalizeFilings("0000320193", columns());
    expect(first!.documentUrl).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
    );
    expect(first!.filingIndexUrl).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/0000320193-25-000079-index.htm",
    );
  });

  test("falls back to the index page when there is no primary document", () => {
    // Verified live: 109 of Apple's 1,249 pre-2015 filings have none, and the
    // index URL resolves for them while a constructed document URL would 404.
    const [, older] = normalizeFilings("0000320193", columns());
    expect(older!.documentUrl).toBe(older!.filingIndexUrl);
    expect(older!.documentUrl).toContain("-index.htm");
  });

  test("converts EDGAR's empty strings to null", () => {
    const [, older] = normalizeFilings("0000320193", columns());
    expect(older!.acceptanceDateTime).toBeNull();
    expect(older!.items).toBeNull();
    expect(older!.description).toBeNull();
  });

  test("converts the 0/1 XBRL flags to booleans, inline counting as XBRL", () => {
    const [first, older] = normalizeFilings("0000320193", columns());
    expect(first!.isXBRL).toBe(true);
    expect(older!.isXBRL).toBe(false);

    const [inlineOnly] = normalizeFilings(
      "0000320193",
      columns({ isXBRL: [0, 0], isInlineXBRL: [1, 0] }),
    );
    expect(inlineOnly!.isXBRL).toBe(true);
  });

  test("canonicalizes the form while preserving EDGAR's literal string", () => {
    const [first, second] = normalizeFilings(
      "0000320193",
      columns({ form: ["10-K405", "SCHEDULE 13G/A"] }),
    );
    expect(first!.form).toBe("10-K");
    expect(first!.rawForm).toBe("10-K405");
    expect(first!.isAmendment).toBe(false);

    expect(second!.form).toBe("SC 13G/A");
    expect(second!.rawForm).toBe("SCHEDULE 13G/A");
    expect(second!.isAmendment).toBe(true);
  });

  describe("documentKind", () => {
    test("classifies a narrative filing as a document", () => {
      const [row] = normalizeFilings("0000320193", columns({
        primaryDocument: ["aapl-20250927.htm", ""],
      }));
      expect(row!.documentKind).toBe("document");
      expect(row!.documentUrl).toEndWith("/aapl-20250927.htm");
    });

    test("classifies an EDGAR-rendered XML filing as a form", () => {
      // Form 3/4/5, 144 and the modern 13D/G filings are structured XML that
      // EDGAR renders through its own stylesheet. They are forms, not
      // documents, and the UI must not label them as documents.
      for (const doc of [
        "xslF345X06/form4.xml",
        "xsl144X01/primary_doc.xml",
        "xslSCHEDULE_13G_X02/primary_doc.xml",
      ]) {
        const [row] = normalizeFilings("0000320193", columns({ primaryDocument: [doc, ""] }));
        expect(row!.documentKind).toBe("form");
        expect(row!.documentUrl).toEndWith(`/${doc}`);
      }
    });

    test("classifies a filing with no primary document as an index link", () => {
      const [, older] = normalizeFilings("0000320193", columns());
      expect(older!.documentKind).toBe("index");
      expect(older!.documentUrl).toBe(older!.filingIndexUrl);
    });

    test("treats a .paper placeholder as an index link, not a document", () => {
      // Paper filings name a ".paper" key that does not exist in EDGAR's
      // archive: HEAD answers 200 but GET returns 404 (NoSuchKey), so the
      // constructed URL is a dead link. The index page does exist.
      const [row] = normalizeFilings("0000320193", columns({
        primaryDocument: ["9999999997-17-006550.paper", ""],
      }));
      expect(row!.documentKind).toBe("index");
      expect(row!.documentUrl).toBe(row!.filingIndexUrl);
      expect(row!.documentUrl).not.toContain(".paper");
    });
  });

  test("handles an empty block", () => {
    const empty = Object.fromEntries(
      Object.keys(columns()).map((k) => [k, []]),
    ) as unknown as FilingsColumns;
    expect(normalizeFilings("0000320193", empty)).toEqual([]);
  });
});
