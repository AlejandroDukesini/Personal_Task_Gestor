import { useState } from "react";
import toast from "react-hot-toast";
import { CalendarClock, ChevronDown, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { ScheduleEditor, draftToInput, toDraft, validateDraft, type ScheduleDraft } from "@/components/habits/ScheduleEditor";
import { api } from "@/services/api";
import { loadPrefs } from "@/services/gcal/prefs";
import { isDesktop } from "@/lib/desktop";
import type { GcalLinkRow } from "@/services/localDb";
import type { Category, Habit, HabitFrequency } from "@/types";
import { cn } from "@/lib/utils";

const COLORS = ["#6366f1", "#10b981", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];
const DAYS = ["D", "L", "M", "X", "J", "V", "S"];

/** Sección plegable: evita sobrecargar el formulario. */
function Section({ title, icon, children, defaultOpen = false }: { title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 p-3 text-sm font-medium" aria-expanded={open}>
        {icon} {title}
        <ChevronDown size={15} className={cn("ml-auto transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="p-3 pt-0 space-y-3">{children}</div>}
    </div>
  );
}

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
    unit: habit?.unit ?? "",
    categoryId: habit?.categoryId ?? "",
    showInCalendar: habit?.showInCalendar ?? true,
    gcalSync: habit?.gcalSync ?? false,
  });
  const [schedules, setSchedules] = useState<ScheduleDraft[]>(() => (habit?.schedules ?? []).map(toDraft));
  const [saving, setSaving] = useState(false);
  const gcal = loadPrefs();

  function toggleDay(day: number) {
    const set = new Set((form.daysOfWeek ?? "").split(",").filter(Boolean));
    if (set.has(String(day))) set.delete(String(day));
    else set.add(String(day));
    setForm((f) => ({ ...f, daysOfWeek: [...set].sort().join(",") }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const invalid = schedules.map(validateDraft).find(Boolean);
    if (invalid) {
      toast.error(`Horario: ${invalid}`);
      return;
    }
    if (!Number.isInteger(form.dailyTarget) || form.dailyTarget < 1) {
      toast.error("La meta diaria debe ser un número entero mayor que 0");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, unit: form.unit.trim() || null, categoryId: form.categoryId || null };
      const saved = habit ? await api.put<Habit>(`/habits/${habit.id}`, payload) : await api.post<Habit>(`/habits`, payload);

      // Horarios quitados que tenían evento en Google: se pregunta qué hacer.
      let remote: "keep" | "future" = "keep";
      const kept = new Set(schedules.map((s) => s.id).filter(Boolean));
      const removed = (habit?.schedules ?? []).filter((s) => !kept.has(s.id)).map((s) => s.id);
      if (removed.length) {
        const links = await api.get<GcalLinkRow[]>("/gcal/links");
        if (links.some((l) => removed.includes(l.scheduleId))) {
          remote = confirm(
            "Quitaste horarios que están en Google Calendar.\n\nAceptar: quitar también sus eventos futuros de Google (los pasados se conservan).\nCancelar: dejar los eventos de Google como están."
          )
            ? "future"
            : "keep";
        }
      }
      if (habit || schedules.length) {
        await api.put(`/habits/${saved.id}/schedules`, { schedules: schedules.map(draftToInput), remote });
      }
      toast.success(habit ? "Hábito actualizado" : "Hábito creado");
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
        <Input autoFocus required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Descripción (opcional)">
        <Textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>

      <Field label="Color">
        <div className="flex gap-2 flex-wrap">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setForm({ ...form, color: c })}
              className={cn("h-8 w-8 rounded-full border-2 transition-transform", form.color === c ? "border-text scale-110" : "border-transparent")}
              style={{ background: c }}
              aria-label={`Color ${c}`}
              aria-pressed={form.color === c}
            />
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="Meta diaria" hint={form.dailyTarget > 1 ? "Cada clic suma una" : "Un clic lo completa"}>
          <Input type="number" min={1} max={1000} step={1} value={form.dailyTarget} onChange={(e) => setForm({ ...form, dailyTarget: Math.floor(Number(e.target.value)) || 0 })} />
        </Field>
        <Field label="Unidad (opcional)">
          <Input placeholder="vasos, min, págs…" maxLength={24} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        </Field>
        <Field label="Frecuencia">
          <Select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as HabitFrequency })}>
            <option value="daily">Diario</option>
            <option value="weekly">Semanal</option>
            <option value="monthly">Mensual</option>
            <option value="custom">Personalizado</option>
          </Select>
        </Field>
        <Field label="Categoría">
          <Select value={form.categoryId ?? ""} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">Sin categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {habit && form.dailyTarget !== habit.dailyTarget && (
        <p className="text-xs text-subtle -mt-2">El cambio de meta se aplica desde hoy; los días anteriores conservan la meta que tenían.</p>
      )}

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
                  className={cn("h-9 w-9 rounded-lg border text-sm font-medium", active ? "bg-primary text-primary-fg border-primary" : "border-border hover:bg-muted")}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </Field>
      )}

      <Section title={`Programación${schedules.length ? ` (${schedules.length})` : ""}`} icon={<CalendarClock size={15} />} defaultOpen={schedules.length > 0}>
        <ScheduleEditor value={schedules} onChange={setSchedules} />
        <p className="text-xs text-subtle">
          Un horario solo indica cuándo está previsto: nunca marca el hábito como realizado.
        </p>
      </Section>

      <Section title="Calendario y automatización" icon={<Settings2 size={15} />}>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={form.showInCalendar} onChange={(e) => setForm({ ...form, showInCalendar: e.target.checked })} />
          <span>
            Mostrar sus horarios en el calendario de la app
            <span className="block text-xs text-subtle">Se actualizan solos al cambiar la programación.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={form.gcalSync} onChange={(e) => setForm({ ...form, gcalSync: e.target.checked })} />
          <span>
            Sincronizar con Google Calendar
            <span className="block text-xs text-subtle">
              {isDesktop
                ? "Google Calendar no está disponible en la versión de escritorio; se aplicará desde la versión web."
                : !gcal.connected
                ? "Google Calendar no está conectado en este dispositivo (Configuración › Integraciones)."
                : gcal.scope === "all"
                  ? "La integración sincroniza todos los hábitos programados; esta opción cuenta si eliges «solo los seleccionados»."
                  : "Se incluirá en la próxima sincronización."}
            </span>
          </span>
        </label>
      </Section>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" loading={saving}>
          {habit ? "Guardar" : "Crear hábito"}
        </Button>
      </div>
    </form>
  );
}
