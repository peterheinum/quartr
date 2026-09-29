import type { Filing } from "@quartr/shared";
import { parseForm } from "../src/edgar/forms";

/** Builds a filing with realistic defaults; override only what a test cares about. */
export function filing(
  rawForm: string,
  filingDate: string,
  overrides: Partial<Filing> = {},
): Filing {
  const parsed = parseForm(rawForm);
  const accessionNumber =
    overrides.accessionNumber ?? `0000320193-${filingDate.slice(2, 4)}-${filingDate.replace(/-/g, "").slice(4)}`;
  return {
    accessionNumber,
    form: parsed.canonical,
    rawForm,
    isAmendment: parsed.isAmendment,
    filingDate,
    reportDate: null,
    acceptanceDateTime: `${filingDate}T12:00:00.000Z`,
    items: null,
    description: null,
    size: 1000,
    isXBRL: false,
    documentKind: "document",
    documentUrl: `https://www.sec.gov/Archives/edgar/data/320193/x/${accessionNumber}.htm`,
    filingIndexUrl: `https://www.sec.gov/Archives/edgar/data/320193/x/${accessionNumber}-index.htm`,
    ...overrides,
  };
}
