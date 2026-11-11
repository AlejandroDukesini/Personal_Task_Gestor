import { useEffect, useRef, useState } from "react";
import { CalendarRange, CheckCircle2, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Empty } from "@/components/ui/Empty";
import { Badge } from "@/components/ui/Badge";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { ActionMenu, formatDay, MenuItem } from "@/components/projects/shared";
import { api } from "@/services/api";
import { newId, type AcadSemesterRow } from "@/services/localDb";
import { cn } from "@/lib/utils";
import { run, type SemesterSummary } from "./shared";

interface Props {
  semesters: SemesterSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  reload: () => void;
}

/** Semestres: actual y anteriores, con su contenido. Elegir uno cambia todo el módulo. */
export function SemestersView({ semesters, selectedId, onSelect, reload }: Props) {
  const [editing, setEditing] = useState<AcadSemesterRow | "new" | null>(null);

  function remove(s: SemesterSummary) {
    const detail = [s.subjectCount && `${s.subjectCount} materias`, s.classCount && `${s.classCount} clases`, s.activityCount && `${s.activityCount} actividades`].filter(Boolean).join(", ");
    if (!confirm(`¿Eliminar el semestre «${s.name}»${detail ? ` junto con ${detail}` : ""}? Antes se guardará una copia de seguridad automática.`)) return;
    run(() => api.delete(`/academic/semesters/${s.id}`), "Semestre eliminado", reload);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-subtle">Cada semestre guarda sus propias materias, horario y actividades.</p>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus size={14} /> Nuevo semestre
        </Button>
      </div>
      {semesters.length === 0 ? (
        <Empty icon={CalendarRange} title="Aún no hay semestres" description="Crea tu semestre actual para empezar a registrar materias, horario y entregas." action={<Button onClick={() => setEditing("new")}><Plus size={16} /> Crear semestre</Button>} />
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {semesters.map((s) => (
            <li key={s.id} className={cn("gt-surface p-4 flex flex-col gap-2", s.id === selectedId && "ring-2 ring-primary/40")}>
              <div className="flex items-start gap-2">
                <button className="flex-1 min-w-0 text-left" onClick={() => onSelect(s.id)}>
                  <span className="font-medium block truncate">{s.name}</span>
                  <span className="text-xs text-subtle">
                    {formatDay(s.startDate)} → {formatDay(s.endDate)}
                  </span>
                </button>
                {s.active && (
                  <Badge className="text-success bg-success/10">
                    <Star size={11} aria-hidden /> Activo
                  </Badge>
                )}
                <ActionMenu label={`Acciones de ${s.name}`}>
                  {!s.active && <MenuItem icon={<CheckCircle2 size={14} />} onClick={() => run(() => api.post(`/academic/semesters/${s.id}/activate`), "Semestre marcado como activo", reload)}>Marcar como activo</MenuItem>}
                  <MenuItem icon={<Pencil size={14} />} onClick={() => setEditing(s)}>Editar</MenuItem>
                  <MenuItem icon={<Trash2 size={14} />} danger onClick={() => remove(s)}>Eliminar</MenuItem>
                </ActionMenu>
              </div>
              {s.notes && <p className="text-sm text-subtle line-clamp-2">{s.notes}</p>}
              <p className="text-xs text-subtle tabular-nums">
                {s.subjectCount} materias · {s.classCount} clases · {s.activityCount} actividades
              </p>
              {s.id !== selectedId && (
                <Button size="sm" variant="outline" className="self-start" onClick={() => onSelect(s.id)}>
                  Consultar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <SemesterForm
        open={!!editing}
        semester={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(s) => {
          reload();
          onSelect(s.id);
        }}
      />
    </div>
  );
}

export function SemesterForm({ open, semester, onClose, onSaved }: { open: boolean; semester: AcadSemesterRow | null; onClose: () => void; onSaved: (s: AcadSemesterRow) => void }) {
  const [form, setForm] = useState({ name: "", startDate: "", endDate: "", active: false, notes: "" });
  const [busy, setBusy] = useState(false);
  const idRef = useRef(newId());

  useEffect(() => {
    if (!open) return;
    idRef.current = newId();
    setForm({ name: semester?.name ?? "", startDate: semester?.startDate ?? "", endDate: semester?.endDate ?? "", active: semester?.active ?? false, notes: semester?.notes ?? "" });
  }, [open, semester]);

  const dateError = form.startDate && form.endDate && form.endDate < form.startDate ? "La fecha de finalización no puede ser anterior a la de inicio" : null;
  const valid = form.name.trim() && form.startDate && form.endDate && !dateError;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    const body = { name: form.name.trim(), startDate: form.startDate, endDate: form.endDate, active: form.active, notes: form.notes.trim() || null };
    const ok = await run(
      async () => onSaved(semester ? await api.put<AcadSemesterRow>(`/academic/semesters/${semester.id}`, body) : await api.post<AcadSemesterRow>("/academic/semesters", { ...body, id: idRef.current })),
      semester ? "Semestre actualizado" : "Semestre creado",
      () => undefined
    );
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title={semester ? "Editar semestre" : "Nuevo semestre"} size="sm">
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Nombre">
          <Input required autoFocus maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej.: 2026-2" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Inicio">
            <Input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </Field>
          <Field label="Finalización" error={dateError}>
            <Input type="date" required min={form.startDate || undefined} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Notas" hint="Opcional.">
          <Textarea maxLength={5000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-primary h-4 w-4" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Es mi semestre actual
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={!valid}>
            {semester ? "Guardar" : "Crear semestre"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
