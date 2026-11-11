import { useEffect, useRef, useState } from "react";
import { BookOpen, Clock, Mail, MapPin, Pencil, Plus, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { SidePanel } from "@/components/ui/SidePanel";
import { ColorPicker } from "@/components/notes/pickers";
import { ActionMenu, MenuItem } from "@/components/projects/shared";
import { api } from "@/services/api";
import { newId, type AcadSubjectRow } from "@/services/localDb";
import { DAY_SHORT, toMinutes } from "@/services/academic/logic";
import { DEFAULT_SUBJECT_COLOR } from "@/services/academic/routes";
import { run, SubjectDot, type AcademicState } from "./shared";

/** Materias del semestre elegido, con su horario y su carga de actividades. */
export function SubjectsView({ data, reload }: { data: AcademicState; reload: () => void }) {
  const [editing, setEditing] = useState<AcadSubjectRow | "new" | null>(null);
  const semester = data.semester!;
  const totalCredits = data.subjects.reduce((s, x) => s + (x.credits ?? 0), 0);

  function remove(s: AcadSubjectRow) {
    const classes = data.classes.filter((c) => c.subjectId === s.id).length;
    const acts = data.activities.filter((a) => a.subjectId === s.id).length;
    const detail = [classes && `${classes} clases del horario`, acts && `${acts} actividades`].filter(Boolean).join(" y ");
    if (!confirm(`¿Eliminar la materia «${s.name}»${detail ? ` junto con ${detail}` : ""}? Antes se guardará una copia de seguridad automática.`)) return;
    run(() => api.delete(`/academic/subjects/${s.id}`), "Materia eliminada", reload);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-subtle">
          {data.subjects.length} materias en {semester.name}
          {totalCredits > 0 && ` · ${totalCredits.toLocaleString("es")} créditos`}
        </p>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus size={14} /> Nueva materia
        </Button>
      </div>

      {data.subjects.length === 0 ? (
        <Card>
          <Empty icon={BookOpen} title="Sin materias en este semestre" description="Registra tus asignaturas con su profesor, aula y color para reconocerlas en el horario." action={<Button onClick={() => setEditing("new")}><Plus size={16} /> Añadir materia</Button>} />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data.subjects.map((s) => {
            const slots = data.classes.filter((c) => c.subjectId === s.id).sort((a, b) => a.day - b.day || toMinutes(a.startTime) - toMinutes(b.startTime));
            const acts = data.activities.filter((a) => a.subjectId === s.id);
            const open = acts.filter((a) => a.status !== "done").length;
            return (
              <li key={s.id} className="gt-surface p-4 flex flex-col gap-2 border-l-4" style={{ borderLeftColor: s.color }}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium flex items-center gap-2">
                      <SubjectDot color={s.color} />
                      <span className="truncate">{s.name}</span>
                    </p>
                    <p className="text-xs text-subtle">
                      {[s.code, s.credits != null && `${s.credits} créditos`].filter(Boolean).join(" · ") || "Sin código"}
                    </p>
                  </div>
                  <ActionMenu label={`Acciones de ${s.name}`}>
                    <MenuItem icon={<Pencil size={14} />} onClick={() => setEditing(s)}>Editar</MenuItem>
                    <MenuItem icon={<Trash2 size={14} />} danger onClick={() => remove(s)}>Eliminar</MenuItem>
                  </ActionMenu>
                </div>
                <dl className="text-sm space-y-1">
                  {s.professor && (
                    <div className="flex items-center gap-2"><User size={14} className="text-subtle shrink-0" aria-hidden /><dt className="sr-only">Profesor</dt><dd className="truncate">{s.professor}</dd></div>
                  )}
                  {s.professorContact && (
                    <div className="flex items-center gap-2"><Mail size={14} className="text-subtle shrink-0" aria-hidden /><dt className="sr-only">Contacto</dt><dd className="truncate">{s.professorContact}</dd></div>
                  )}
                  {s.room && (
                    <div className="flex items-center gap-2"><MapPin size={14} className="text-subtle shrink-0" aria-hidden /><dt className="sr-only">Aula</dt><dd>{s.room}</dd></div>
                  )}
                  <div className="flex items-start gap-2">
                    <Clock size={14} className="text-subtle shrink-0 mt-0.5" aria-hidden />
                    <dt className="sr-only">Horario</dt>
                    <dd className="text-subtle">{slots.length ? slots.map((c) => `${DAY_SHORT[c.day]} ${c.startTime}–${c.endTime}`).join(" · ") : "Sin clases en el horario"}</dd>
                  </div>
                </dl>
                {s.description && <p className="text-sm text-subtle line-clamp-3 whitespace-pre-line">{s.description}</p>}
                <p className="text-xs text-subtle tabular-nums mt-auto">
                  {acts.length} actividades · {open} pendientes
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <SubjectForm open={!!editing} subject={editing === "new" ? null : editing} semesterId={semester.id} onClose={() => setEditing(null)} reload={reload} />
    </div>
  );
}

const empty = { name: "", code: "", professor: "", professorContact: "", room: "", credits: "", description: "", color: DEFAULT_SUBJECT_COLOR as string };

export function SubjectForm({ open, subject, semesterId, onClose, reload }: { open: boolean; subject: AcadSubjectRow | null; semesterId: string; onClose: () => void; reload: () => void }) {
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const idRef = useRef(newId());

  useEffect(() => {
    if (!open) return;
    idRef.current = newId();
    setForm(
      subject
        ? {
            name: subject.name,
            code: subject.code ?? "",
            professor: subject.professor ?? "",
            professorContact: subject.professorContact ?? "",
            room: subject.room ?? "",
            credits: subject.credits != null ? String(subject.credits) : "",
            description: subject.description ?? "",
            color: subject.color,
          }
        : empty
    );
  }, [open, subject]);

  const credits = form.credits.trim() === "" ? null : Number(form.credits.replace(",", "."));
  const creditsError = credits !== null && (!Number.isFinite(credits) || credits < 0 || credits > 100) ? "Introduce un número entre 0 y 100" : null;
  const valid = form.name.trim() && !creditsError;

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!valid) return;
    setBusy(true);
    const body = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      professor: form.professor.trim() || null,
      professorContact: form.professorContact.trim() || null,
      room: form.room.trim() || null,
      credits,
      description: form.description.trim() || null,
      color: form.color,
    };
    const ok = await run(
      () => (subject ? api.put(`/academic/subjects/${subject.id}`, body) : api.post("/academic/subjects", { ...body, id: idRef.current, semesterId })),
      subject ? "Materia actualizada" : "Materia creada",
      reload
    );
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={subject ? "Editar materia" : "Nueva materia"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} disabled={!valid} onClick={() => submit()}>{subject ? "Guardar" : "Crear materia"}</Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Nombre de la asignatura">
          <Input required autoFocus maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej.: Cálculo diferencial" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Código">
            <Input maxLength={40} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MAT-101" />
          </Field>
          <Field label="Créditos" error={creditsError}>
            <Input inputMode="decimal" value={form.credits} onChange={(e) => setForm({ ...form, credits: e.target.value })} placeholder="3" />
          </Field>
        </div>
        <Field label="Profesor responsable">
          <Input maxLength={120} value={form.professor} onChange={(e) => setForm({ ...form, professor: e.target.value })} />
        </Field>
        <Field label="Contacto del profesor" hint="Correo, teléfono u horario de atención (opcional).">
          <Input maxLength={300} value={form.professorContact} onChange={(e) => setForm({ ...form, professorContact: e.target.value })} />
        </Field>
        <Field label="Aula">
          <Input maxLength={80} value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="Bloque B · 204" />
        </Field>
        <Field label="Descripción">
          <Textarea maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <ColorPicker value={form.color} onChange={(c) => setForm({ ...form, color: c ?? DEFAULT_SUBJECT_COLOR })} label="Color identificador" />
        <p className="text-xs text-subtle">El horario de la materia se define en la pestaña «Horario».</p>
        <button type="submit" hidden />
      </form>
    </SidePanel>
  );
}
