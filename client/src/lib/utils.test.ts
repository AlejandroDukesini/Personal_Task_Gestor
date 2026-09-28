import { describe, expect, it } from "vitest";
import { asLocalDay, formatDate, isOverdue } from "./utils";

describe("fechas de vencimiento", () => {
  it("la medianoche UTC guardada se lee como ese mismo día local", () => {
    const d = asLocalDay("2026-09-27T00:00:00.000Z");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 8, 27]);
    expect(formatDate("2026-09-27T00:00:00.000Z")).toMatch(/27/);
  });

  it("una tarea que vence hoy no está vencida hasta que acaba el día", () => {
    const t = new Date();
    const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    expect(isOverdue(`${key}T00:00:00.000Z`, "pending")).toBe(false);
    expect(isOverdue(`${key}T00:00:00.000Z`, "pending", "00:00")).toBe(true);
    expect(isOverdue("2000-01-01T00:00:00.000Z", "completed")).toBe(false);
  });
});
