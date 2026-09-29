import { describe, expect, test } from "bun:test";
import { classify } from "../src/turnover";

const H = "Item 5.02 Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers; Compensatory Arrangements of Certain Officers. ";

// Real false positives from the 30-company corpus: only the parent company's own CEO/CFO should count.
describe("own-company CEO/CFO only", () => {
  test("a segment CEO retiring is not a CEO change: Walmart International", () => {
    const f = classify(H + "On August 14, 2023, Judith McKenna, age 57, the Company’s Executive Vice President, President and Chief Executive Officer, Walmart International, notified Walmart Inc. of her intent to retire.", "Walmart|Wal-Mart");
    expect(f.ceoOut).toBe(false);
  });
  test("a business-unit CEO: PepsiCo Beverages North America", () => {
    const f = classify(H + "On January 16, 2024, Kirk Tanner, Chief Executive Officer, PepsiCo Beverages North America, notified PepsiCo, Inc. of his intent to resign from the Company.", "PepsiCo");
    expect(f.ceoOut).toBe(false);
  });
  test("a division CEO with a dash: Chief Executive Officer - Beauty", () => {
    expect(classify(H + "Alexandra Keith, currently Chief Executive Officer – Beauty, announced her intention to retire from the Company.", "Procter|P&G").ceoOut).toBe(false);
  });
  test("another firm's CEO in a director biography", () => {
    expect(classify(H + "Mr. White is the recently retired chairman, president and CEO of DIRECTV.", "Bank of America").ceoOut).toBe(false);
  });
  test("a subsidiary's CEO: WhatsApp", () => {
    const f = classify(H + "In connection with his resignation from his position as Chief Executive Officer of WhatsApp Inc., Jan Koum informed Facebook, Inc. that he will not stand for re-election.", "Meta|Facebook");
    expect(f.ceoOut).toBe(false);
  });
  test("the company's own CEO passes, named with 'of <Company>'", () => {
    const f = classify(H + "On May 12, 2025, Andrew Witty, Chief Executive Officer of UnitedHealth Group Incorporated, notified the Company of his decision to step down from his position.", "UnitedHealth");
    expect(f.ceoOut).toBe(true);
  });
  test("the company's own CEO passes: 'the Company's Chairman and Chief Executive Officer'", () => {
    const f = classify(H + "Kenneth C. Frazier, the Company’s Chairman and Chief Executive Officer, will retire as Chief Executive Officer, effective June 30, 2021.", "Merck");
    expect(f.ceoOut).toBe(true);
  });
  test("'reporting to the CEO' does not make the CEO the person leaving", () => {
    const f = classify(H + "In connection with his retirement, Mr. Geagea will transition to Senior Advisor to the Company’s Chairman and Chief Executive Officer.", "Chevron");
    expect(f.ceoOut).toBe(false);
  });
  test("a policy on mandatory retirement is governance, not a departure", () => {
    expect(classify(H + "The Board rescinded its policy subjecting the Company’s Chief Executive Officer to mandatory retirement at age 65.", "Merck").ceoOut).toBe(false);
  });
});
