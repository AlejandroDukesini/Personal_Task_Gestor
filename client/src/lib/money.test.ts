import { describe, expect, it } from "vitest";
import { formatMoney, parseMoney, sumCents, toInputValue } from "./money";

describe("parseMoney", () => {
  it.each([
    ["1234", 123400],
    ["1234.5", 123450],
    ["1234,56", 123456],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["1.200.000", 120000000],
    ["$ 1 200", 120000],
    ["-20", -2000],
    ["(15,50)", -1550],
    ["0,1", 10],
    [".5", 50],
    ["12,", 1200],
    ["COP 50000", 5000000],
  ])("%s -> %i céntimos", (input, cents) => {
    expect(parseMoney(input)).toBe(cents);
  });

  it.each(["", "abc", "1,2,3", "12.345.6", "1.2.3,4.5", "12,34.56"])("rechaza «%s»", (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it("rechaza más de dos decimales en vez de redondear en silencio", () => {
    expect(parseMoney("1.999")).toBe(199900); // 1.999 = mil novecientos noventa y nueve
    expect(parseMoney("1,999.999")).toBeNull();
  });

  it("rechaza importes absurdos", () => {
    expect(parseMoney("999999999999999999")).toBeNull();
  });
});

describe("aritmética exacta", () => {
  it("0,10 + 0,20 = 0,30 exactamente", () => {
    const a = parseMoney("0,10")!;
    const b = parseMoney("0,20")!;
    expect(a + b).toBe(parseMoney("0,30"));
  });

  it("sumar un millón de céntimos no acumula error", () => {
    const values = Array.from({ length: 100000 }, () => 10); // 100.000 × 0,10
    expect(sumCents(values)).toBe(1_000_000);
  });

  it("sumCents rechaza valores no enteros", () => {
    expect(() => sumCents([1.5])).toThrow();
  });

  it("toInputValue es la inversa de parseMoney", () => {
    for (const c of [0, 5, 100, 123456, -9999, 10_000_000_00]) {
      expect(parseMoney(toInputValue(c))).toBe(c);
    }
  });

  it("formatMoney pinta con la moneda", () => {
    expect(formatMoney(123456, "USD", { locale: "en-US" })).toBe("$1,234.56");
    expect(formatMoney(500, "COP", { signed: true })).toMatch(/^\+/);
  });
});
