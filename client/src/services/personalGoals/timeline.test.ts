import { describe, expect, it } from "vitest";
import { buildTimeline, gapFor, GAP_MAX, GAP_MIN } from "./timeline";

const g = (id: string, targetDate: string, startDate: string | null = null) => ({ id, targetDate, startDate });

describe("línea del tiempo", () => {
  it("divide por los años que tienen metas (más el actual) y respeta el orden de fechas", () => {
    const years = buildTimeline([g("moto", "2027-10-18"), g("viaje", "2030-03-01"), g("curso", "2026-12-01")], "2026-11-11", false);
    expect(years.map((y) => y.year)).toEqual([2026, 2027, 2030]); // sin años vacíos intermedios
    expect(years[0].entries.map((e) => e.kind)).toEqual(["today", "goal"]);
    expect(years[1].entries.map((e) => (e.kind === "goal" ? e.goal.id : e.kind))).toEqual(["moto"]);
    expect(years[1].entries[0].date).toBe("2027-10-18"); // exactamente en su fecha
  });

  it("las metas pasadas siguen apareciendo", () => {
    const years = buildTimeline([g("vieja", "2024-05-05")], "2026-11-11", false);
    expect(years.map((y) => y.year)).toEqual([2024, 2026]);
  });

  it("«hoy» se sitúa entre las metas de su año", () => {
    const years = buildTimeline([g("a", "2026-03-01"), g("b", "2026-12-24")], "2026-11-11", false);
    expect(years[0].entries.map((e) => (e.kind === "goal" ? e.goal.id : e.kind))).toEqual(["a", "today", "b"]);
  });

  it("separación proporcional pero acotada: metas cercanas no se superponen", () => {
    const years = buildTimeline([g("a", "2027-05-01"), g("b", "2027-05-01"), g("c", "2027-05-02"), g("d", "2027-12-31")], "2026-11-11", false);
    const gaps = years[1].entries.map((e) => e.gap);
    expect(gaps[1]).toBe(GAP_MIN); // mismo día: separación mínima, nunca 0
    expect(gaps[2]).toBeGreaterThan(GAP_MIN);
    expect(gaps[3]).toBe(GAP_MAX); // meses de diferencia: acotado
    expect(gapFor(-5)).toBe(GAP_MIN);
  });

  it("marca el inicio de las metas que lo tienen (antes que su objetivo)", () => {
    const years = buildTimeline([g("m", "2027-10-18", "2026-12-01")], "2026-11-11");
    expect(years[0].entries.map((e) => e.kind)).toEqual(["today", "start"]);
    expect(years[1].entries.map((e) => e.kind)).toEqual(["goal"]);
  });
});
