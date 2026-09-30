import { describe, expect, it } from "vitest";
import { toKey } from "../dates";
import {
  detectDateOrder,
  detectDecimal,
  isBalanceCorrection,
  parseBool,
  parseColor,
  parseCurrency,
  parseFlexibleAmount,
  parseFlexibleDate,
  parseKind,
} from "./normalize";

const date = (v: unknown, order?: "dmy" | "mdy") => parseFlexibleDate(v, order).date;
const cents = (v: unknown, dec: "," | "." | null = null) => parseFlexibleAmount(v, dec).cents;

describe("fechas", () => {
  it("ISO con y sin hora, milisegundos y separadores", () => {
    expect(date("2026-09-26")).toBe("2026-09-26");
    expect(date("2026/9/6")).toBe("2026-09-06");
    expect(date("2026-09-26 23:34:31")).toBe("2026-09-26");
    expect(date("2026-09-26 23:34:31.000")).toBe("2026-09-26");
    expect(date("2026-09-26T23:34:31.123")).toBe("2026-09-26");
  });

  it("ISO con zona: el día es el del reloj local", () => {
    const iso = "2026-09-26T23:34:31.000Z";
    expect(date(iso)).toBe(toKey(new Date(iso)));
    expect(date("2026-09-26T10:00:00+02:00")).toBe(toKey(new Date("2026-09-26T10:00:00+02:00")));
  });

  it("DD/MM/AAAA, con guiones, puntos, hora y AM/PM", () => {
    expect(date("26/09/2026")).toBe("2026-09-26");
    expect(date("6-9-2026")).toBe("2026-09-06");
    expect(date("26.09.2026 18:05")).toBe("2026-09-26");
    expect(date("26/09/2026 06:05 p. m.")).toBe("2026-09-26");
  });

  it("orden MM/DD cuando se indica, e intercambio si el mes es imposible", () => {
    expect(date("03/04/2026", "mdy")).toBe("2026-03-04");
    expect(date("03/04/2026", "dmy")).toBe("2026-04-03");
    const r = parseFlexibleDate("09/26/2026", "dmy");
    expect(r.date).toBe("2026-09-26");
    expect(r.fixed).toMatch(/intercambiados/);
  });

  it("años de 2 cifras se corrigen y se avisa", () => {
    const r = parseFlexibleDate("26/09/26");
    expect(r.date).toBe("2026-09-26");
    expect(r.fixed).toMatch(/2 cifras/);
  });

  it("timestamps Unix en segundos, milisegundos y microsegundos", () => {
    const s = 1790483671;
    const expected = toKey(new Date(s * 1000));
    expect(date(s)).toBe(expected);
    expect(date(String(s))).toBe(expected);
    expect(date(s * 1000)).toBe(expected);
    expect(date(s * 1_000_000)).toBe(expected);
    expect(parseFlexibleDate(s).ts).toBe(s * 1000);
  });

  it("serial de Excel y AAAAMMDD", () => {
    expect(date(46291)).toBe("2026-09-26");
    expect(date(46291.75)).toBe("2026-09-26");
    expect(date(20260926)).toBe("2026-09-26");
    expect(date("20260926")).toBe("2026-09-26");
  });

  it("nombres de mes en español, inglés y portugués", () => {
    expect(date("26 sep 2026")).toBe("2026-09-26");
    expect(date("26 de septiembre de 2026")).toBe("2026-09-26");
    expect(date("Sep 26, 2026")).toBe("2026-09-26");
    expect(date("26-dic-2025")).toBe("2025-12-26");
    expect(date("5 de março de 2026")).toBe("2026-03-05");
  });

  it("rechaza lo imposible con un motivo", () => {
    expect(parseFlexibleDate("2026-02-30").error).toMatch(/imposible/);
    expect(parseFlexibleDate("31/31/2026").error).toMatch(/imposible/);
    expect(parseFlexibleDate("ayer").error).toBeTruthy();
    expect(parseFlexibleDate("").error).toMatch(/vacía/);
    expect(parseFlexibleDate(null).date).toBeNull();
  });

  it("detecta el orden de la columna por los valores que no admiten duda", () => {
    expect(detectDateOrder(["01/02/2026", "25/03/2026"])).toEqual({ order: "dmy", ambiguous: false });
    expect(detectDateOrder(["01/02/2026", "03/25/2026"])).toEqual({ order: "mdy", ambiguous: false });
    expect(detectDateOrder(["01/02/2026", "03/04/2026"])).toEqual({ order: "dmy", ambiguous: true });
    expect(detectDateOrder(["2026-01-02"]).ambiguous).toBe(false);
  });
});

describe("importes", () => {
  it("separadores de cualquier convención", () => {
    expect(cents("1234")).toBe(123400);
    expect(cents("1.234,56")).toBe(123456);
    expect(cents("1,234.56")).toBe(123456);
    expect(cents("12,5")).toBe(1250);
    expect(cents("1.200.000")).toBe(120000000);
    expect(cents("1 200 000,00")).toBe(120000000);
    expect(cents("1'234.50")).toBe(123450);
    expect(cents("1 234,50")).toBe(123450);
  });

  it("el separador decimal de la columna resuelve «1.234»", () => {
    expect(cents("1.234")).toBe(123400);
    expect(cents("1.234", ".")).toBe(123);
    expect(cents("1,5", ".")).toBe(150); // un solo «,» con 1 cifra: decimal, se avisa
    expect(parseFlexibleAmount("1,5", ".").fixed).toMatch(/decimal/);
    expect(cents("0.007")).toBe(1); // «0.» nunca es separador de miles
  });

  it("signos: menos delante o detrás, contable, CR/DR y menos tipográfico", () => {
    expect(cents("-20")).toBe(-2000);
    expect(cents("20-")).toBe(-2000);
    expect(cents("(1.200,00)")).toBe(-120000);
    expect(cents("+15")).toBe(1500);
    expect(cents("150 DR")).toBe(-15000);
    expect(cents("150 CR")).toBe(15000);
    expect(cents("− 5")).toBe(-500);
  });

  it("monedas: símbolos y códigos se separan del número", () => {
    expect(parseFlexibleAmount("$ 1.200")).toMatchObject({ cents: 120000, currency: null });
    expect(parseFlexibleAmount("COP 20.000")).toMatchObject({ cents: 2000000, currency: "COP" });
    expect(parseFlexibleAmount("12,50 €")).toMatchObject({ cents: 1250, currency: "EUR" });
    expect(parseFlexibleAmount("US$ 9.99")).toMatchObject({ cents: 999, currency: "USD" });
    expect(parseFlexibleAmount("-20 usd")).toMatchObject({ cents: -2000, currency: "USD" });
  });

  it("más de 2 decimales: redondea y avisa; el ruido de coma flotante no", () => {
    const r = parseFlexibleAmount("12.345678");
    expect(r.cents).toBe(1235);
    expect(r.fixed).toMatch(/Redondeado/);
    expect(parseFlexibleAmount("39999.99999999999")).toMatchObject({ cents: 4000000, fixed: undefined });
    expect(parseFlexibleAmount(39999.99999999999)).toMatchObject({ cents: 4000000, fixed: undefined });
    expect(parseFlexibleAmount(0.007994)).toMatchObject({ cents: 1, lossy: true });
    expect(parseFlexibleAmount(7.8e-5).cents).toBe(0);
    expect(cents("7.8e-05")).toBe(0);
    expect(cents("1.5E3")).toBe(150000);
  });

  it("números ya numéricos (Excel, JSON, SQLite) no tienen ambigüedad", () => {
    expect(cents(1234.5)).toBe(123450);
    expect(cents(-5000)).toBe(-500000);
  });

  it("rechaza lo que no es un importe", () => {
    expect(parseFlexibleAmount("abc").cents).toBeNull();
    expect(parseFlexibleAmount("12a").cents).toBeNull();
    expect(parseFlexibleAmount("1.23.4,5,6").cents).toBeNull();
    expect(parseFlexibleAmount("").error).toMatch(/vacío/);
    expect(parseFlexibleAmount(true).cents).toBeNull();
    expect(parseFlexibleAmount("999999999999999").error).toMatch(/grande/);
  });

  it("detecta el separador decimal de una columna", () => {
    expect(detectDecimal(["1.234,56", "20"])).toBe(",");
    expect(detectDecimal(["1,234.56"])).toBe(".");
    expect(detectDecimal(["12,5", "3,25"])).toBe(",");
    expect(detectDecimal(["1.200.000"])).toBe(",");
    expect(detectDecimal(["1000", "2000"])).toBeNull();
  });
});

describe("tipos, booleanos, monedas y colores", () => {
  it("tipos en varios idiomas y convenciones bancarias", () => {
    expect(parseKind("Gasto")).toBe("expense");
    expect(parseKind("DÉBITO")).toBe("expense");
    expect(parseKind("withdrawal")).toBe("expense");
    expect(parseKind("Abono")).toBe("income");
    expect(parseKind("deposit")).toBe("income");
    expect(parseKind("Traspaso")).toBe("transfer");
    expect(parseKind("Corrección")).toBe("adjustment");
    expect(parseKind("default")).toBeNull();
    expect(isBalanceCorrection("Corrección de Balance")).toBe(true);
    expect(isBalanceCorrection("Balance correction")).toBe(true);
    expect(isBalanceCorrection("Comida")).toBe(false);
  });

  it("booleanos", () => {
    expect(parseBool("true")).toBe(true);
    expect(parseBool("Sí")).toBe(true);
    expect(parseBool("FALSO")).toBe(false);
    expect(parseBool(0)).toBe(false);
    expect(parseBool("quizá")).toBeNull();
  });

  it("monedas", () => {
    expect(parseCurrency("cop")).toEqual({ code: "COP" });
    expect(parseCurrency("€")).toEqual({ code: "EUR" });
    expect(parseCurrency("$")).toEqual({ code: "" });
    expect(parseCurrency("usdt")).toEqual({ invalid: "usdt" });
  });

  it("colores ARGB de Cashew", () => {
    expect(parseColor("0XFF66BB6A")).toBe("#66bb6a");
    expect(parseColor("#ABCDEF")).toBe("#abcdef");
    expect(parseColor("rojo")).toBeNull();
  });
});
