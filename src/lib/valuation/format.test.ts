import { describe, expect, it } from "vitest";
import { formatAssumption, formatMoney, formatSignedPercent, fromInputValue, toInputValue } from "./format";

describe("input conversion", () => {
  it("shows percentages as whole numbers and reads them back as decimals", () => {
    expect(toInputValue(0.085, "percent")).toBe("8.5");
    expect(fromInputValue("8.5", "percent")).toBeCloseTo(0.085);
    expect(toInputValue(123.456, "currency")).toBe("123.46");
    expect(fromInputValue("1,250", "currency")).toBe(1250);
  });

  it("treats blank or invalid input as missing", () => {
    expect(fromInputValue("  ", "multiple")).toBeNull();
    expect(fromInputValue("abc", "years")).toBeNull();
    expect(toInputValue(null, "percent")).toBe("");
  });
});

describe("display formatting", () => {
  it("formats money, signed percentages and assumptions", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney(null, "USD")).toBe("—");
    expect(formatSignedPercent(0.123)).toBe("+12.3%");
    expect(formatSignedPercent(-0.05)).toBe("-5.0%");
    expect(formatAssumption(5, "years", "USD")).toBe("5 years");
    expect(formatAssumption(18, "multiple", "USD")).toBe("18.0×");
  });
});
