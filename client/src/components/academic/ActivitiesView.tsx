import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Circle, ExternalLink, ListChecks, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { SidePanel } from "@/components/ui/SidePanel";
import { ProgressBar } from "@/components/projects/shared";
import { api } from "@/services/api";
import { newId, type AcadActivityRow, type AcadActivityStatus, type AcadActivityType } from "@/services/localDb";
import { activityState, filterActivities, PRIORITY_LABEL, STATE_LABEL, TYPE_LABEL, typeLabel, type ActivityFilter, type ActivitySort, type ActivityState } from "@/services/academic/logic";
import { ACTIVITY_STATUSES, ACTIVITY_TYPES, MAX_REFERENCES, PRIORITIES } from "@/services/academic/schemas";
import { cn } from "@/lib/utils";
import { PriorityText, run, shortDay, StateBadge, SubjectDot, type AcademicState } from "./shared";

/** Actividades del semestre: filtros, lista y edición en panel lateral. */
export function ActivitiesView({ data, reload }: { data: AcademicState; reload: () => void }) {
  const [filter, setFilter] = useState<ActivityFilter>({});
  const [sort, setSort] = useState<ActivitySort>("due");
  const [editing, setEditing] = useState<AcadActivityRow | "new" | null>(null);
  const subjects = useMemo(() => new Map(data.subjects.map((s) => [s.id, s])), [data.subjects]);
  const items = useMemo(() => filterActivities(data.activities, data.subjects, data.today, filter, sort), [data, filter, sort]);
  const active = Object.values(filter).some(Boolean);

  const set = <K extends keyof ActivityFilter>(k: K, v: ActivityFilter[K] | "") => setFilter((f) => ({ ...f, [k]: v || undefined }));

  function toggleDone(a: AcadActivityRow) {
    const done = a.status !== "done";
    run(() => api.put(`/academic/activities/${a.id}`, { status: done ? "done" : "pending", ...(done ? {} : { progress: 0 }) }), done ? "Actividad completada" : "Actividad reabierta", reload);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
          <Input aria-label="Buscar actividades" className="pl-8" placeholder="Buscar…" value={filter.q ?? ""} onChange={(e) => set("q", e.target.value)} />
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus size={14} /> Nueva actividad
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
        <Select aria-label="Materia" value={filter.subjectId ?? ""} onChange={(e) => set("subjectId", e.target.value)}>
          <option value="">Todas las materias</option>
          {data.subjects.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
          <option value="none">Sin materia</option>
        </Select>
        <Select aria-label="Estado" value={filter.state ?? ""} onChange={(e) => set("state", e.target.value as ActivityState)}>
          <option value="">Todos los estados</option>
          {(Object.keys(STATE_LABEL) as ActivityState[]).map((s) => (
            <option key={s} value={s}>{STATE_LABEL[s]}</option>
          ))}
        </Select>
        <Select aria-label="Prioridad" value={filter.priority ?? ""} onChange={(e) => set("priority", e.target.value as AcadActivityRow["priority"])}>
          <option value="">Toda prioridad</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
          ))}
        </Select>
        <Select aria-label="Tipo" value={filter.type ?? ""} onChange={(e) => set("type", e.target.value as AcadActivityType)}>
          <option value="">Todos los tipos</option>
          {ACTIVITY_TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </Select>
        <Input type="date" aria-label="Desde" title="Fecha límite desde" value={filter.from ?? ""} onChange={(e) => set("from", e.target.value)} />
        <Input type="date" aria-label="Hasta" title="Fecha límite hasta" value={filter.to ?? ""} onChange={(e) => set("to", e.target.value)} />
        <Select aria-label="Ordenar" value={sort} onChange={(e) => setSort(e.target.value as ActivitySort)}>
          <option value="due">Por fecha límite</option>
          <option value="priority">Por prioridad</option>
          <option value="created">Más recientes</option>
          <option value="title">Por título</option>
        </Select>
      </div>
      {active && (
        <button className="text-xs text-primary inline-flex items-center gap-1" onClick={() => setFilter({})}>
          <X size={12} /> Quitar filtros
        </button>
      )}

      {items.length === 0 ? (
        <Card>
          <Empty
            icon={ListChecks}
            title={data.activities.length ? "Ninguna actividad coincide con los filtros" : "Sin actividades todavía"}
            description={data.activities.length ? undefined : "Registra tareas, parciales, exposiciones y entregas con su fecha límite."}
            action={!data.activities.length && <Button onClick={() => setEditing("new")}><Plus size={16} /> Añadir actividad</Button>}
          />
        </Card>
      ) : (
        <ul className="gt-surface divide-y divide-border">
          {items.map((a) => {
            const st = activityState(a, data.today);
            const s = a.subjectId ? subjects.get(a.subjectId) : null;
            return (
              <li key={a.id} className="flex items-center gap-3 p-3">
                <button onClick={() => toggleDone(a)} className={cn("h-9 w-9 -m-1 flex items-center justify-center rounded-md shrink-0 hover:bg-muted", a.status === "done" ? "text-success" : "text-subtle")} aria-label={a.status === "done" ? `Reabrir ${a.title}` : `Completar ${a.title}`}>
                  {a.status === "done" ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                </button>
                <button className="flex-1 min-w-0 text-left" onClick={() => setEditing(a)}>
                  <span className={cn("font-medium block truncate", a.status === "done" && "line-through text-subtle")}>{a.title}</span>
                  <span className="text-xs text-subtle flex items-center gap-1.5 flex-wrap">
                    {s && (
                      <span className="inline-flex items-center gap-1">
                        <SubjectDot color={s.color} className="h-2 w-2" /> {s.name}
                      </span>
                    )}
                    <span>{typeLabel(a)}</span>
                    {a.dueDate && <span className={cn(st === "overdue" && "text-danger font-medium")}>· {shortDay(a.dueDate)}{a.dueTime && ` ${a.dueTime}`}</span>}
                  </span>
                </button>
                <div className="hidden sm:flex flex-col items-end gap-1 w-32 shrink-0">
                  <StateBadge state={st} />
                  {a.status !== "done" && a.progress > 0 && <ProgressBar value={a.progress} color={s?.color ?? "rgb(var(--primary))"} label={`Avance de ${a.title}`} className="h-1.5" />}
                </div>
                <span className="sm:hidden"><StateBadge state={st} /></span>
              </li>
            );
          })}
        </ul>
      )}

      <ActivityForm open={!!editing} activity={editing === "new" ? null : editing} data={data} onClose={() => setEditing(null)} reload={reload} />
    </div>
  );
}

interface Form {
  title: string;
  description: string;
  subjectId: string;
  type: AcadActivityType;
  customType: string;
  dueDate: string;
  dueTime: string;
  priority: AcadActivityRow["priority"];
  status: AcadActivityStatus;
  progress: number;
  references: { id: string; label: string; url: string }[];
  observations: string;
}

const formOf = (a: AcadActivityRow | null, defaults: Partial<Form>): Form => ({
  title: a?.title ?? "",
  description: a?.description ?? "",
  subjectId: a?.subjectId ?? defaults.subjectId ?? "",
  type: a?.type ?? defaults.type ?? "task",
  customType: a?.customType ?? "",
  dueDate: a?.dueDate ?? "",
  dueTime: a?.dueTime ?? "",
  priority: a?.priority ?? "medium",
  status: a?.status ?? "pending",
  progress: a?.progress ?? 0,
  references: a?.references.map((r) => ({ id: r.id, label: r.label, url: r.url ?? "" })) ?? [],
  observations: a?.observations ?? "",
});

const STATUS_TEXT: Record<AcadActivityStatus, string> = { pending: "Pendiente", in_progress: "En progreso", review: "En revisión", done: "Completada" };

export function ActivityForm({ open, activity, data, onClose, reload, defaults = {} }: { open: boolean; activity: AcadActivityRow | null; data: AcademicState; onClose: () => void; reload: () => void; defaults?: Partial<Form> }) {
  const [form, setForm] = useState<Form>(() => formOf(activity, defaults));
  const [busy, setBusy] = useState(false);
  const idRef = useRef(newId());

  useEffect(() => {
    if (!open) return;
    idRef.current = newId();
    setForm(formOf(activity, defaults));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activity]);

  const badUrl = form.references.find((r) => r.url.trim() && !/^https?:\/\//i.test(r.url.trim()));
  const valid = form.title.trim() && (form.type !== "other" || form.customType.trim()) && !badUrl && form.references.every((r) => r.label.trim());

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!valid) return;
    setBusy(true);
    const body = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      subjectId: form.subjectId || null,
      type: form.type,
      customType: form.type === "other" ? form.customType.trim() : null,
      dueDate: form.dueDate || null,
      dueTime: form.dueDate && form.dueTime ? form.dueTime : null,
      priority: form.priority,
      status: form.status,
      progress: form.status === "done" ? 100 : form.progress,
      references: form.references.map((r) => ({ id: r.id, label: r.label.trim(), url: r.url.trim() || null })),
      observations: form.observations.trim() || null,
    };
    const ok = await run(
      () => (activity ? api.put(`/academic/activities/${activity.id}`, body) : api.post("/academic/activities", { ...body, id: idRef.current, semesterId: data.semester!.id })),
      activity ? "Actividad actualizada" : "Actividad creada",
      reload
    );
    setBusy(false);
    if (ok) onClose();
  }

  function remove() {
    if (!activity || !confirm(`¿Eliminar la actividad «${activity.title}»?`)) return;
    run(() => api.delete(`/academic/activities/${activity.id}`), "Actividad eliminada", reload).then((ok) => ok && onClose());
  }

  const patchRef = (i: number, patch: Partial<Form["references"][number]>) => setForm({ ...form, references: form.references.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      width="lg"
      title={activity ? "Editar actividad" : "Nueva actividad"}
      description={activity ? `Creada el ${new Date(activity.createdAt).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}` : undefined}
      footer={
        <>
          {activity && (
            <Button variant="ghost" className="mr-auto text-danger" onClick={remove}>
              <Trash2 size={14} /> Eliminar
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} disabled={!valid} onClick={() => submit()}>{activity ? "Guardar" : "Crear actividad"}</Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Título">
          <Input required autoFocus maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ej.: Taller 3 de integrales" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Materia">
            <Select value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
              <option value="">Sin materia (general)</option>
              {data.subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo de actividad">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AcadActivityType })}>
              {ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>{t === "other" ? "Otra (personalizada)" : TYPE_LABEL[t]}</option>
              ))}
            </Select>
          </Field>
        </div>
        {form.type === "other" && (
          <Field label="Nombre del tipo" error={!form.customType.trim() ? "Indica qué tipo de actividad es" : null}>
            <Input maxLength={60} value={form.customType} onChange={(e) => setForm({ ...form, customType: e.target.value })} placeholder="Laboratorio, taller, quiz…" />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha límite">
            <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </Field>
          <Field label="Hora" hint="Opcional.">
            <Input type="time" disabled={!form.dueDate} value={form.dueTime} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Prioridad">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Form["priority"] })}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Estado" hint={form.status !== "done" && form.dueDate && form.dueDate < data.today ? "Se mostrará como «Vencida»." : undefined}>
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AcadActivityStatus })}>
              {ACTIVITY_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_TEXT[s]}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={`Avance: ${form.status === "done" ? 100 : form.progress} %`}>
          <input type="range" min={0} max={100} step={5} disabled={form.status === "done"} value={form.status === "done" ? 100 : form.progress} onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })} className="w-full accent-primary" />
        </Field>
        <Field label="Descripción">
          <Textarea maxLength={20000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-subtle uppercase tracking-wide">Archivos y referencias</legend>
          {form.references.map((r, i) => (
            <div key={r.id} className="flex gap-2 items-start">
              <Input aria-label="Nombre de la referencia" maxLength={200} placeholder="Nombre (p. ej. Enunciado)" value={r.label} onChange={(e) => patchRef(i, { label: e.target.value })} />
              <Input aria-label="Enlace" maxLength={2000} placeholder="https://… (opcional)" value={r.url} onChange={(e) => patchRef(i, { url: e.target.value })} aria-invalid={r === badUrl || undefined} />
              {/^https?:\/\//i.test(r.url.trim()) && (
                <a href={r.url.trim()} target="_blank" rel="noreferrer noopener" className="h-9 w-9 shrink-0 flex items-center justify-center rounded-md text-subtle hover:bg-muted" aria-label={`Abrir ${r.label || "enlace"}`}>
                  <ExternalLink size={14} />
                </a>
              )}
              <button type="button" className="h-9 w-9 shrink-0 flex items-center justify-center rounded-md text-subtle hover:bg-muted" aria-label="Quitar referencia" onClick={() => setForm({ ...form, references: form.references.filter((_, j) => j !== i) })}>
                <X size={14} />
              </button>
            </div>
          ))}
          {badUrl && <p className="text-xs text-danger" role="alert">El enlace debe empezar por http:// o https://</p>}
          {form.references.length < MAX_REFERENCES && (
            <Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, references: [...form.references, { id: newId(), label: "", url: "" }] })}>
              <Plus size={14} /> Añadir referencia
            </Button>
          )}
        </fieldset>

        <Field label="Observaciones">
          <Textarea maxLength={5000} value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} />
        </Field>
        {activity && (
          <p className="text-xs text-subtle">
            Estado actual: <StateBadge state={activityState(activity, data.today)} /> · <PriorityText priority={activity.priority} />
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </SidePanel>
  );
}
