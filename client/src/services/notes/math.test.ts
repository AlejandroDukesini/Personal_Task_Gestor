import { describe, expect, it } from "vitest";
import { evaluate, findCalculations, formatRatio, looksLikeCalculation, MathError } from "./math";

const calc = (expr: string, decimals: number | null = null) => formatRatio(evaluate(expr), { decimals }).text;
const results = (text: string) => findCalculations(text).map((c) => (c.result ?? `!${c.error}`));

describe("aritmética exacta", () => {
  it("las cuatro operaciones y los ejemplos pedidos", () => {
    expect(calc("200+200")).toBe("400");
    expect(calc("150+350")).toBe("500");
    expect(calc("1000-250")).toBe("750");
    expect(calc("25*4")).toBe("100");
    expect(calc("100/5")).toBe("20");
    expect(calc("(200+300)*2")).toBe("1000");
    expect(calc("500-125")).toBe("375");
    expect(calc("25*8")).toBe("200");
    expect(calc("144/12")).toBe("12");
    expect(calc("(50+50)*3")).toBe("300");
    expect(calc("12.5+7.5")).toBe("20");
  });

  it("precedencia, paréntesis anidados, negativos y signos", () => {
    expect(calc("2+3*4")).toBe("14");
    expect(calc("(2+3)*4")).toBe("20");
    expect(calc("((1+2)*(3+4))/7")).toBe("3");
    expect(calc("-5+3")).toBe("-2");
    expect(calc("10*-2")).toBe("-20");
    expect(calc("-(4-10)")).toBe("6");
    expect(calc("8/2/2")).toBe("2");
    expect(calc("10-2-3")).toBe("5");
  });

  it("sin errores de coma flotante", () => {
    expect(calc("0.1+0.2")).toBe("0.3");
    expect(calc("1.1*3")).toBe("3.3");
    expect(calc("19.99*3")).toBe("59.97");
    expect(calc("0.3-0.1")).toBe("0.2");
    expect(calc("123456789012345678.9+0.1")).toBe("123456789012345679");
  });

  it("porcentaje con convención inequívoca: x% = x/100", () => {
    expect(calc("200*10%")).toBe("20");
    expect(calc("50%")).toBe("0.5");
    expect(calc("1500*19%")).toBe("285");
  });

  it("símbolos tipográficos y coma decimal", () => {
    expect(calc("6×7")).toBe("42");
    expect(calc("9÷3")).toBe("3");
    expect(calc("12,5+7,5")).toBe("20");
  });

  it("redondeo al presentar: automático hasta 10 decimales o fijo, mitad lejos de cero", () => {
    expect(calc("1/3")).toBe("0.3333333333");
    expect(calc("2/3")).toBe("0.6666666667");
    expect(calc("1/3", 2)).toBe("0.33");
    expect(calc("10/4", 0)).toBe("3");
    expect(calc("-10/4", 0)).toBe("-3");
    expect(calc("7", 2)).toBe("7.00");
    expect(formatRatio(evaluate("1/3")).exact).toBe(false);
    expect(formatRatio(evaluate("1/4")).exact).toBe(true);
  });

  it("errores claros: división entre cero, expresiones incompletas o con texto", () => {
    expect(() => evaluate("5/0")).toThrow(MathError);
    expect(() => evaluate("5/(2-2)")).toThrow(/cero/);
    expect(() => evaluate("2+")).toThrow(/incompleta/);
    expect(() => evaluate("(2+3")).toThrow(/paréntesis/);
    expect(() => evaluate("2 3")).toThrow();
    expect(() => evaluate("alert(1)")).toThrow(/no admitido/);
    expect(() => evaluate("2**3")).toThrow();
  });

  it("límites contra expresiones abusivas", () => {
    expect(() => evaluate("1".repeat(40))).toThrow(/largo/);
    expect(() => evaluate("(".repeat(60) + "1" + ")".repeat(60))).toThrow();
    expect(() => evaluate("9".repeat(29) + "*" + "9".repeat(29) + "*9".repeat(80))).toThrow();
  });
});

describe("reconocimiento dentro del texto", () => {
  it("calcula tras el signo igual y conserva la posición", () => {
    const [c] = findCalculations("200+200=");
    expect(c).toMatchObject({ from: 0, eq: 7, expression: "200+200", result: "400", manual: null });
    expect(results("Total del mes: 150+350= euros")).toEqual(["500"]);
    expect(results("a) 1000-250= b) 25*4= c) 100/5=")).toEqual(["750", "100", "20"]);
  });

  it("espacios, varias operaciones por línea y cadenas", () => {
    expect(results("( 200 + 300 ) * 2 =")).toEqual(["1000"]);
    expect(results("2+2=4+1=")).toEqual(["4", "5"]);
    // Un número que empieza otra expresión no es el «resultado manual» de la anterior.
    expect(results("(200+300)*2= 12.5+7.5= -5+3=")).toEqual(["1000", "20", "-2"]);
    expect(findCalculations("2+2= 3+3=").map((c) => c.manual)).toEqual([null, null]);
  });

  it("toma solo la parte que es cálculo cuando hay números antes", () => {
    const [c] = findCalculations("Tengo 3 cajas y 2+2=");
    expect(c.expression).toBe("2+2");
    expect(findCalculations("Pedido 45 2*3=")[0].expression).toBe("2*3");
  });

  it("no confunde fechas, teléfonos, identificadores ni cifras dentro de palabras", () => {
    expect(results("La reunión es el 26/09/2026 = jueves")).toEqual([]);
    expect(results("2026-09-26=")).toEqual([]);
    expect(results("Llama al 300-555-1234=")).toEqual([]);
    expect(results("código 007+1=")).toEqual([]);
    expect(results("abc12+3=")).toEqual([]);
    expect(results("versión v1.2+1=")).toEqual([]);
    expect(results("x = 5")).toEqual([]);
    expect(results("5=5")).toEqual([]);
    expect(results("if (a == b) c <= 3 >= 2 != 1 =>")).toEqual([]);
    expect(results("Saldo: 2.500 y 3.000 COP")).toEqual([]);
    expect(looksLikeCalculation("100-20-5")).toBe(true); // resta encadenada, no una fecha
    expect(looksLikeCalculation("12-5-3")).toBe(true);
  });

  it("expresiones incompletas o inválidas: indicación discreta, nunca un resultado falso", () => {
    expect(results("5/0=")).toEqual(["!División entre cero"]);
    expect(results("2+=")).toEqual(["!Expresión incompleta"]);
    expect(results("(2+3=")).toEqual(["!Falta cerrar un paréntesis"]);
  });

  it("resultado escrito a mano: se distingue y se comprueba", () => {
    const [ok] = findCalculations("200+200=400 y sigo");
    expect(ok.manual).toEqual({ from: 8, to: 11, text: "400", mismatch: false });
    const [bad] = findCalculations("200+200=500");
    expect(bad.manual?.mismatch).toBe(true);
    // Menos decimales que el exacto, bien redondeados: no es un error.
    expect(findCalculations("1/3=0.33")[0].manual?.mismatch).toBe(false);
    expect(findCalculations("1/3=0.34")[0].manual?.mismatch).toBe(true);
  });

  it("usa el separador decimal de la propia expresión", () => {
    expect(results("12,5*2=")).toEqual(["25"]);
    expect(results("7,5/2=")).toEqual(["3,75"]);
    expect(findCalculations("1/3=", { decimals: 2 })[0].result).toBe("0.33");
  });

  it("rendimiento: un texto largo se analiza rápido", () => {
    const text = "Línea con 12+30= y más texto normal. ".repeat(2000);
    const t0 = performance.now();
    expect(findCalculations(text)).toHaveLength(2000);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
