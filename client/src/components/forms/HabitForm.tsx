import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { api } from "@/services/api";
import type { Category, Habit, HabitFrequency } from "@/types";
import { cn } from "@/lib/utils";

const COLORS = ["#6366f1", "#10b981", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];
const DAYS = ["D", "L", "M", "X", "J", "V", "S"];

export function HabitForm({
  habit,
  categories,
  onSaved,
}: {
  habit: Habit | null;
  categories: Category[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: habit?.name ?? "",
    description: habit?.description ?? "",
    color: habit?.color ?? "#10b981",
    frequency: (habit?.frequency ?? "daily") as HabitFrequency,
    daysOfWeek: habit?.daysOfWeek ?? "",
    dailyTarget: habit?.dailyTarget ?? 1,
    categoryId: habit?.categoryId ?? "",
  });
  const [saving, setSaving] = useState(false);

  function toggleDay(day: number) {
    const set = new Set((form.daysOfWeek ?? "").split(",").filter(Boolean));
    if (set.has(String(day))) set.delete(String(day));
    else set.add(String(day));
    setForm((f) => ({ ...f, daysOfWeek: [...set].sort().join(",") }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, categoryId: form.categoryId || null };
      if (habit) {
        await api.put(`/habits/${habit.id}`, payload);
        toast.success("Hábito actualizado");
      } else {
        await api.post(`/habits`, payload);
        toast.success("Hábito creado");
      }
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nombre">
        <Input
          autoFocus
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <Field label="Descripción">
        <Textarea
          value={form.description ?? ""}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </Field>

      <Field label="Color">
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setForm({ ...form, color: c })}
              className={cn(
                "h-8 w-8 rounded-full border-2 transition-transform",
                form.color === c ? "border-text scale-110" : "border-transparent"
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Frecuencia">
          <Select
            value={form.frequency}
            onChange={(e) =>
              setForm({ ...form, frequency: e.target.value as HabitFrequency })
            }
          >
            <option value="daily">Diario</option>
            <option value="weekly">Semanal</option>
            <option value="monthly">Mensual</option>
            <option value="custom">Personalizado</option>
          </Select>
        </Field>
        <Field label="Meta diaria">
          <Input
            type="number"
            min={1}
            value={form.dailyTarget}
            onChange={(e) => setForm({ ...form, dailyTarget: Number(e.target.value) })}
          />
        </Field>
        <Field label="Categoría">
          <Select
            value={form.categoryId ?? ""}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
          >
            <option value="">Sin categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {form.frequency === "custom" && (
        <Field label="Días de la semana">
          <div className="flex gap-2">
            {DAYS.map((d, idx) => {
              const active = form.daysOfWeek?.split(",").includes(String(idx));
              return (
                <button
                  type="button"
                  key={d}
                  onClick={() => toggleDay(idx)}
                  className={cn(
                    "h-9 w-9 rounded-lg border text-sm font-medium",
                    active
                      ? "bg-primary text-primary-fg border-primary"
                      : "border-border hover:bg-muted"
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </Field>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" loading={saving}>
          {habit ? "Guardar" : "Crear hábito"}
        </Button>
      </div>
    </form>
  );
}
