import { useMemo, useState } from "react";
import { AlertTriangle, BookOpen, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Clock, GraduationCap, ListTodo } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ProgressBar } from "@/components/projects/shared";
import type { AcadActivityRow } from "@/services/localDb";
import { activityState, addDays, daysBetween, typeLabel } from "@/services/academic/logic";
import { cn } from "@/lib/utils";
import { ActivityForm } from "./ActivitiesView";
import { shortDay, StateBadge, SubjectDot, type AcademicState } from "./shared";

/** Panel del semestre: todo se deriva de los registros al leer, así que siempre está al día. */
export function AcademicOverviewView({ data, onGoTab, reload }: { data: AcademicState; onGoTab: (tab: string) => void; reload: () => void }) {
  const o = data.overview!;
  const [open, setOpen] = useState<AcadActivityRow | null>(null);
  const subjects = useMemo(() => new Map(data.subjects.map((s) => [s.id, s])), [data.subjects]);

  const stats = [
    { label: "Pendientes", value: o.pendingCount, icon: ListTodo, cls: "text-primary" },
    { label: "Completadas", value: o.doneCount, icon: CheckCircle2, cls: "text-success" },
    { label: "Vencidas", value: o.overdue.length, icon: AlertTriangle, cls: o.overdue.length ? "text-danger" : "text-subtle" },
    { label: "Avance medio", value: `${Math.round(o.averageProgress)} %`, icon: GraduationCap, cls: "text-text" },
  ];

  const row = (a: AcadActivityRow) => {
    const s = a.subjectId ? subjects.get(a.subjectId) : null;
    const left = a.dueDate ? daysBetween(data.today, a.dueDate) : null;
    return (
      <li key={a.id}>
        <button className="w-full flex items-center gap-2 py-2 text-left hover:bg-muted/50 rounded-md px-2 -mx-2" onClick={() => setOpen(a)}>
          <SubjectDot color={s?.color ?? "#94a3b8"} />
          <span className="flex-1 min-w-0">
            <span className="block truncate text-sm font-medium">{a.title}</span>
            <span className="block text-xs text-subtle truncate">{[s?.name, typeLabel(a)].filter(Boolean).join(" · ")}</span>
          </span>
          {a.dueDate && (
            <span className={cn("text-xs text-right shrink-0 tabular-nums", left !== null && left < 0 ? "text-danger" : left !== null && left <= 2 ? "text-warning" : "text-subtle")}>
              {shortDay(a.dueDate)}
              <span className="block">{left === 0 ? "hoy" : left === 1 ? "mañana" : left! < 0 ? `hace ${-left!} d` : `en ${left} d`}</span>
            </span>
          )}
        </button>
      </li>
    );
  };

  const list = (items: AcadActivityRow[], empty: string) => (items.length ? <ul className="divide-y divide-border/60">{items.slice(0, 6).map(row)}</ul> : <p className="text-sm text-subtle py-2">{empty}</p>);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs text-subtle flex items-center gap-1.5">
              <s.icon size={14} className={s.cls} aria-hidden /> {s.label}
            </p>
            <p className="gt-heading text-2xl mt-1 tabular-nums">{s.value}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><CalendarClock size={16} aria-hidden /> Próximas entregas</CardTitle>
            <button className="text-xs text-primary" onClick={() => onGoTab("actividades")}>Ver todas</button>
          </CardHeader>
          <CardContent className="pt-2">{list(o.upcoming, "Nada pendiente en las próximas dos semanas.")}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><GraduationCap size={16} aria-hidden /> Próximos parciales</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">{list(o.upcomingExams, "Sin parciales programados.")}</CardContent>
        </Card>
      </div>

      {o.overdue.length > 0 && (
        <Card className="border-l-4 border-l-danger">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-danger"><AlertTriangle size={16} aria-hidden /> Vencidas sin completar</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">{list(o.overdue, "")}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock size={16} aria-hidden /> Resumen de la semana</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-subtle">
              {shortDay(o.week.from)} – {shortDay(o.week.to)}
            </p>
            <p className="tabular-nums">
              {o.week.classes} clases · {o.week.hours.toLocaleString("es", { maximumFractionDigits: 1 })} h · {o.week.due.length} entregas esta semana
            </p>
            <div>
              <p className="text-xs font-medium text-subtle uppercase tracking-wide mb-1">Clases de hoy</p>
              {o.week.today.length ? (
                <ul className="space-y-1">
                  {o.week.today.map((c) => {
                    const s = subjects.get(c.subjectId);
                    return (
                      <li key={c.id} className="flex items-center gap-2">
                        <SubjectDot color={s?.color ?? "#94a3b8"} />
                        <span className="tabular-nums text-subtle">{c.startTime}–{c.endTime}</span>
                        <span className="truncate">{s?.name}</span>
                        {(c.room ?? s?.room) && <span className="text-xs text-subtle truncate">· {c.room ?? s?.room}</span>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-subtle">Hoy no tienes clases.</p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-subtle uppercase tracking-wide mb-1">Entregas de la semana</p>
              {o.week.due.length ? (
                <ul className="space-y-1">
                  {o.week.due.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <button className="truncate text-left hover:underline" onClick={() => setOpen(a)}>{a.title}</button>
                      <StateBadge state={activityState(a, data.today)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-subtle">Sin entregas esta semana.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><BookOpen size={16} aria-hidden /> Materias activas</CardTitle>
            <button className="text-xs text-primary" onClick={() => onGoTab("materias")}>Gestionar</button>
          </CardHeader>
          <CardContent className="pt-2">
            {data.subjects.length ? (
              <ul className="space-y-3">
                {data.subjects.map((s) => {
                  const acts = data.activities.filter((a) => a.subjectId === s.id);
                  const avg = acts.length ? acts.reduce((t, a) => t + (a.status === "done" ? 100 : a.progress), 0) / acts.length : 0;
                  return (
                    <li key={s.id} className="space-y-1">
                      <div className="flex items-center gap-2 text-sm">
                        <SubjectDot color={s.color} />
                        <span className="flex-1 truncate">{s.name}</span>
                        <span className="text-xs text-subtle tabular-nums">{acts.filter((a) => a.status !== "done").length} pend.</span>
                      </div>
                      <ProgressBar value={avg} color={s.color} label={`Avance en ${s.name}`} className="h-1.5" />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-subtle">Aún no hay materias.</p>
            )}
          </CardContent>
        </Card>

        <AcademicCalendar data={data} onOpen={setOpen} />
      </div>

      <ActivityForm open={!!open} activity={open} data={data} onClose={() => setOpen(null)} reload={reload} />
    </div>
  );
}

/** Calendario mensual con las fechas límite de las actividades del semestre. */
function AcademicCalendar({ data, onOpen }: { data: AcademicState; onOpen: (a: AcadActivityRow) => void }) {
  const [month, setMonth] = useState(() => data.today.slice(0, 7));
  const [picked, setPicked] = useState<string | null>(null);
  const subjects = useMemo(() => new Map(data.subjects.map((s) => [s.id, s])), [data.subjects]);
  const byDay = useMemo(() => {
    const m = new Map<string, AcadActivityRow[]>();
    for (const a of data.activities) if (a.dueDate) m.set(a.dueDate, [...(m.get(a.dueDate) ?? []), a]);
    return m;
  }, [data.activities]);

  const first = `${month}-01`;
  const dow = new Date(`${first}T00:00:00`).getDay() || 7;
  const start = addDays(first, 1 - dow);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const shift = (n: number) => {
    const d = new Date(`${first}T00:00:00`);
    d.setMonth(d.getMonth() + n);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    setPicked(null);
  };
  const label = new Date(`${first}T00:00:00`).toLocaleDateString("es", { month: "long", year: "numeric" });
  const pickedItems = picked ? byDay.get(picked) ?? [] : [];

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="capitalize">{label}</CardTitle>
        <div className="flex">
          <button className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted" onClick={() => shift(-1)} aria-label="Mes anterior"><ChevronLeft size={16} /></button>
          <button className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted" onClick={() => shift(1)} aria-label="Mes siguiente"><ChevronRight size={16} /></button>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="grid grid-cols-7 text-center text-[11px] text-subtle mb-1">
          {["L", "M", "X", "J", "V", "S", "D"].map((d) => <span key={d}>{d}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((d) => {
            const items = byDay.get(d) ?? [];
            const inMonth = d.startsWith(month);
            const inSemester = data.semester && d >= data.semester.startDate && d <= data.semester.endDate;
            return (
              <button
                key={d}
                onClick={() => setPicked(d === picked ? null : d)}
                className={cn(
                  "h-10 rounded-md flex flex-col items-center justify-start pt-1 text-xs tabular-nums",
                  !inMonth && "opacity-40",
                  inSemester && "bg-muted/40",
                  d === data.today && "ring-1 ring-primary text-primary font-semibold",
                  d === picked && "bg-primary/15"
                )}
                aria-label={`${d}${items.length ? `: ${items.length} actividades` : ""}`}
              >
                {Number(d.slice(8))}
                <span className="flex gap-0.5 mt-0.5">
                  {items.slice(0, 3).map((a) => (
                    <span key={a.id} className="h-1.5 w-1.5 rounded-full" style={{ background: subjects.get(a.subjectId ?? "")?.color ?? "#94a3b8" }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        {picked && (
          <div className="mt-3 border-t border-border pt-2">
            <p className="text-xs text-subtle mb-1">{shortDay(picked)}</p>
            {pickedItems.length ? (
              <ul className="space-y-1">
                {pickedItems.map((a) => (
                  <li key={a.id}>
                    <button className="text-sm hover:underline text-left" onClick={() => onOpen(a)}>
                      {a.title} <span className="text-subtle">· {typeLabel(a)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-subtle">Sin actividades este día.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
