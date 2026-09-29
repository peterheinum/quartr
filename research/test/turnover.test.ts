import { describe, expect, test } from "bun:test";
import { classify } from "../src/turnover";

const H = "Item 5.02 Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers; Compensatory Arrangements of Certain Officers. ";

describe("classify", () => {
  test("the boilerplate heading alone triggers nothing", () => {
    expect(Object.values(classify(H + "None.")).some(Boolean)).toBe(false);
  });
  test("Intel 2024: CEO resigned", () => {
    const f = classify(H + "Resignation of Chief Executive Officer On December 1, 2024, Patrick Gelsinger, Chief Executive Officer and director of Intel Corporation (the “Company”), resigned from the Company and the Board of Directors, effective immediately.");
    expect(f.ceoOut).toBe(true);
    expect(f.cfoOut).toBe(false);
  });
  test("Apple 2024: CFO transitions out of the role", () => {
    const f = classify(H + "On August 26, 2024, Apple Inc. announced that Chief Financial Officer Luca Maestri will transition from his role on January 1, 2025.");
    expect(f.cfoOut).toBe(true);
    expect(f.ceoOut).toBe(false);
  });
  test("Boeing 2024: CEO steps down and the chair does not stand for re-election", () => {
    const f = classify(H + "First, David L. Calhoun decided to step down as President and Chief Executive Officer at the end of 2024. Second, Lawrence W. Kellner, independent Chair of the Board, decided not to stand for re-election.");
    expect(f.ceoOut).toBe(true);
    expect(f.officerOut).toBe(true);
  });
  test("Disney 2022: a CEO is appointed", () => {
    expect(classify(H + "On November 20, 2022, The Walt Disney Company appointed Robert A. Iger as Chief Executive Officer for a term ending December 31, 2024.").ceoIn).toBe(true);
  });
  test("a compensation clause about termination is not a departure", () => {
    const f = classify(H + "The agreement provides that if Mr. Cook, our Chief Executive Officer, is terminated without cause, he will receive severance and accelerated vesting of equity awards.");
    expect(f.ceoOut).toBe(false);
  });
  test("a new director is a director change, not an officer one", () => {
    const f = classify(H + "On December 4, 2024, the board of directors appointed Eric Meurice and Steve Sanghi to the Board, effective immediately.");
    expect(f.directorIn).toBe(true);
    expect(f.ceoIn || f.cfoIn || f.officerIn).toBe(false);
  });
  test("Vice President is not the President", () => {
    expect(classify(H + "John Smith was appointed Senior Vice President of Operations.").officerIn).toBe(false);
  });
  test("null section gives no flags", () => {
    expect(Object.values(classify(null)).some(Boolean)).toBe(false);
  });
});
