import { describe, expect, it } from "vitest";
import { describeRecurrence, expandEvent, recurrenceError } from "./recurrence";
import type { EventRecurrence } from "@/types";

// Clase de 8:00 a 10:00 empezando el lunes 5 de octubre de 2026 (hora local).
const start = new Date(2026, 9, 5, 8, 0).toISOString();
const end = new Date(2026, 9, 5, 10, 0).toISOString();
const ev = (recurrence: EventRecurrence | null) => ({ start, end, recurrence });
const days = (from: Date, to: Date, r: EventRecurrence | null) =>
  expandEvent(ev(r), from, to).map((o) => `${o.start.getMonth() + 1}/${o.start.getDate()} ${o.start.getHours()}h`);

const oct = [new Date(2026, 9, 1), new Date(2026, 10, 1)] as const;

describe("expandEvent", () => {
  it("sin repetición devuelve el evento solo si cae en el rango", () => {
    expect(days(...oct, null)).toEqual(["10/5 8h"]);
    expect(days(new Date(2026, 10, 1), new Date(2026, 11, 1), null)).toEqual([]);
  });

  it("diaria, con intervalo, conserva hora y duración", () => {
    const r = expandEvent(ev({ freq: "daily", interval: 10 }), ...oct);
    expect(r.map((o) => o.start.getDate())).toEqual([5, 15, 25]);
    expect(r.every((o) => o.end.getTime() - o.start.getTime() === 2 * 3600_000 && o.start.getHours() === 8)).toBe(true);
  });

  it("semanal, y no aparece antes del inicio", () => {
    expect(days(...oct, { freq: "weekly" })).toEqual(["10/5 8h", "10/12 8h", "10/19 8h", "10/26 8h"]);
    expect(days(...oct, { freq: "weekly", interval: 2 })).toEqual(["10/5 8h", "10/19 8h"]);
  });

  it("días específicos (lunes y miércoles) hasta una fecha", () => {
    expect(days(...oct, { freq: "days", daysOfWeek: [1, 3], until: "2026-10-14" })).toEqual([
      "10/5 8h",
      "10/7 8h",
      "10/12 8h",
      "10/14 8h",
    ]);
  });

  it("mensual salta los meses sin ese día", () => {
    const s = new Date(2026, 0, 31, 9).toISOString();
    const e = new Date(2026, 0, 31, 10).toISOString();
    const r = expandEvent({ start: s, end: e, recurrence: { freq: "monthly" } }, new Date(2026, 0, 1), new Date(2026, 5, 1));
    expect(r.map((o) => o.start.getMonth() + 1)).toEqual([1, 3, 5]);
  });

  it("rangos lejanos del inicio siguen alineados con la serie", () => {
    const r = days(new Date(2027, 2, 1), new Date(2027, 2, 15), { freq: "weekly", interval: 2 });
    // 5 oct 2026 + 22 semanas = 8 mar 2027.
    expect(r).toEqual(["3/8 8h"]);
  });
});

describe("recurrenceError", () => {
  it("valida días y fin de la repetición", () => {
    expect(recurrenceError(ev({ freq: "days", daysOfWeek: [] }))).toMatch(/día/);
    expect(recurrenceError(ev({ freq: "weekly", until: "2026-10-01" }))).toMatch(/terminar/);
    expect(recurrenceError(ev({ freq: "weekly", until: "2026-10-05" }))).toBeNull();
  });
});

describe("describeRecurrence", () => {
  it("describe la repetición", () => {
    expect(describeRecurrence(null)).toBe("No se repite");
    expect(describeRecurrence({ freq: "days", daysOfWeek: [3, 1] })).toBe("Cada semana: lun, mié");
    expect(describeRecurrence({ freq: "monthly", interval: 2, until: "2026-12-31" })).toBe("Cada 2 meses hasta el 31/12/2026");
  });
});
