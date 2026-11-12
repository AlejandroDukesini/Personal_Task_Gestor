import { useEffect, useId, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Plus, X } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { ColorPicker, IconPicker } from "@/components/notes/pickers";
import { errorMessage } from "@/components/finance/shared";
import { api } from "@/services/api";
import { newId, type ProjectKind, type ProjectObjective, type ProjectRow, type ProjectStatus, type WfPriority } from "@/services/localDb";
import { parseMoney, toInputValue } from "@/lib/money";
import { PRIORITY_LABEL } from "@/services/workflow/logic";
import { WF_PRIORITIES } from "@/services/workflow/schemas";
import type { SopSummary } from "@/services/sops/routes";
import type { ProjectSummary } from "@/services/projects/query";
import { DEFAULT_PROJECT_COLOR, DEFAULT_PROJECT_ICON } from "@/services/projects/routes";
import { STATUS_META } from "./shared";

interface Form {
  title: string;
  icon: string;
  color: string;
  tag: string;
  startDate: string;
  endDate: string;
  description: string;
  status: ProjectStatus;
  objectives: ProjectObjective[];
  stages: { key: string; title: string }[];
  client: string;
  owner: string;
  priority: WfPriority | "";
  budget: string;
  /** Solo al crear: cómo empieza la estructura. */
  start: "blank" | "template" | "project";
  sourceId: string;
}

const formOf = (p?: ProjectRow | null): Form => ({
  title: p?.title ?? "",
  icon: p?.icon ?? DEFAULT_PROJECT_ICON,
  color: p?.color ?? DEFAULT_PROJECT_COLOR,
  tag: p?.tag ?? "",
  startDate: p?.startDate ?? "",
  endDate: p?.endDate ?? "",
  description: p?.description ?? "",
  status: p?.status ?? "active",
  objectives: p?.objectives.map((o) => ({ ...o })) ?? [],
  stages: [],
  client: p?.client ?? "",
  owner: p?.owner ?? "",
  priority: p?.priority ?? "",
  budget: p?.budget != null ? toInputValue(Math.round(p.budget * 100)) : "",
  start: "blank",
  sourceId: "",
});

/**
 * Crear o editar un proyecto. Nada se escribe hasta pulsar «Guardar»:
 * cancelar (o cerrar) no toca los datos, y si había cambios se pide confirmación.
 */
export function ProjectForm({ open, onClose, project, tags, onSaved, initialTemplateId, kind }: { open: boolean; onClose: () => void; project?: ProjectRow | null; tags: string[]; onSaved: (p: ProjectRow) => void; initialTemplateId?: string | null; /** Sección donde se crea (solo al crear). */ kind?: ProjectKind }) {
  const editing = !!project;
  const [form, setForm] = useState<Form>(() => formOf(project));
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<SopSummary[]>([]);
  const [others, setOthers] = useState<ProjectSummary[]>([]);
  const initial = useRef("");
  // Id generado una vez por apertura: un doble clic no crea dos proyectos.
  const idRef = useRef(newId());
  const listId = useId();
  const projectRef = useRef(project);
  projectRef.current = project;

  // Solo al abrir: si el proyecto se actualiza con el formulario abierto, no se pisa lo escrito.
  useEffect(() => {
    if (!open) return;
    const f = formOf(projectRef.current);
    if (!projectRef.current && initialTemplateId) Object.assign(f, { start: "template", sourceId: initialTemplateId });
    setForm(f);
    if (!projectRef.current) {
      api.get<{ items: SopSummary[] }>("/sops?kind=template").then((r) => setTemplates(r.items)).catch(() => setTemplates([]));
      api.get<{ items: ProjectSummary[] }>("/projects?view=all&sort=title&dir=asc").then((r) => setOthers(r.items)).catch(() => setOthers([]));
    }
    initial.current = JSON.stringify(f);
    idRef.current = newId();
  }, [open]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = () => JSON.stringify(form) !== initial.current;
  const dateError = form.startDate && form.endDate && form.endDate < form.startDate ? "La fecha final prevista no puede ser anterior a la de inicio" : null;
  const budgetCents = form.budget.trim() ? parseMoney(form.budget) : null;
  const budgetError = form.budget.trim() && (budgetCents === null || budgetCents < 0) ? "Introduce un importe válido (sin negativos)" : null;
  const sourceError = !editing && form.start !== "blank" && !form.sourceId ? "Elige el origen de la estructura" : null;

  function close() {
    if (busy) return;
    if (dirty() && !confirm("¿Descartar los cambios sin guardar?")) return;
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || dateError || budgetError || sourceError) return;
    setBusy(true);
    const body = {
      title: form.title.trim(),
      icon: form.icon,
      color: form.color,
      tag: form.tag.trim() || null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      description: form.description.trim() || null,
      status: form.status,
      objectives: form.objectives.filter((o) => o.text.trim()).map((o) => ({ ...o, text: o.text.trim() })),
      client: form.client.trim() || null,
      owner: form.owner.trim() || null,
      priority: form.priority || null,
      budget: budgetCents === null ? null : budgetCents / 100,
    };
    const structure = form.start === "blank" ? { stages: form.stages.filter((s) => s.title.trim()).map((s) => ({ title: s.title.trim() })) } : { from: { type: form.start === "template" ? "sop" : "project", id: form.sourceId } };
    try {
      const saved = editing
        ? await api.put<ProjectRow>(`/projects/${project!.id}`, body)
        : await api.post<ProjectRow>("/projects", { ...body, id: idRef.current, kind: kind ?? "professional", ...structure });
      toast.success(editing ? "Proyecto actualizado" : "Proyecto creado");
      onSaved(saved);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title={editing ? "Editar proyecto" : "Nuevo proyecto"} size="lg">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Título">
          <Input required autoFocus maxLength={200} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Ej.: Lanzar la tienda online" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Etiqueta o categoría" hint="Opcional. Sirve para filtrar.">
            <Input maxLength={40} list={listId} value={form.tag} onChange={(e) => set("tag", e.target.value)} placeholder="Ej.: Trabajo" />
          </Field>
          <datalist id={listId}>
            {tags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <Field label="Estado">
            <Select value={form.status} onChange={(e) => set("status", e.target.value as ProjectStatus)}>
              {(Object.keys(STATUS_META) as ProjectStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha de inicio">
            <Input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </Field>
          <Field label="Fecha final prevista" error={dateError}>
            <Input type="date" value={form.endDate} min={form.startDate || undefined} onChange={(e) => set("endDate", e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Cliente o entidad" hint="Opcional.">
            <Input maxLength={150} value={form.client} onChange={(e) => set("client", e.target.value)} placeholder="Ej.: ACME S.A." />
          </Field>
          <Field label="Responsable" hint="Opcional.">
            <Input maxLength={120} value={form.owner} onChange={(e) => set("owner", e.target.value)} />
          </Field>
          <Field label="Prioridad">
            <Select value={form.priority} onChange={(e) => set("priority", e.target.value as WfPriority | "")}>
              <option value="">Sin prioridad</option>
              {WF_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Presupuesto" hint="Opcional. Solo informativo: no crea movimientos." error={budgetError}>
            <Input inputMode="decimal" maxLength={30} value={form.budget} onChange={(e) => set("budget", e.target.value)} placeholder="Ej.: 15.000.000" />
          </Field>
        </div>
        <Field label="Descripción" hint="Admite Markdown básico: **negrita**, - listas, [enlaces](https://…)">
          <Textarea maxLength={20000} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="¿De qué trata el proyecto?" />
        </Field>

        <ListEditor
          legend="Objetivos generales"
          hint="Qué se pretende conseguir. No cuentan para el progreso (lo marcan las etapas)."
          placeholder="Nuevo objetivo"
          items={form.objectives.map((o) => ({ key: o.id, text: o.text, done: o.done }))}
          onChange={(items) => set("objectives", items.map((i) => ({ id: i.key, text: i.text, done: i.done ?? false })))}
          withDone
        />
        {!editing && (
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-subtle uppercase tracking-wide">Estructura de trabajo</legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Cómo empezar">
              {(
                [
                  ["blank", "Desde cero", "Tus propias etapas."],
                  ["template", "Plantilla SOP", "Copia de una plantilla."],
                  ["project", "Otro proyecto", "Duplica su estructura."],
                ] as const
              ).map(([k, label, hint]) => (
                <label key={k} className={`gt-field cursor-pointer p-2.5 text-sm flex items-start gap-2 ${form.start === k ? "ring-2 ring-primary" : ""}`}>
                  <input type="radio" name="start" className="accent-primary mt-0.5" checked={form.start === k} onChange={() => setForm((f) => ({ ...f, start: k, sourceId: "" }))} />
                  <span>
                    <span className="font-medium block">{label}</span>
                    <span className="text-xs text-subtle">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {form.start === "blank" && (
              <ListEditor
                legend="Etapas iniciales (opcional)"
                hint="Empiezan al 0 %. Podrás añadir procedimientos, actividades y listas después."
                placeholder="Nueva etapa"
                items={form.stages.map((s) => ({ key: s.key, text: s.title }))}
                onChange={(items) => set("stages", items.map((i) => ({ key: i.key, title: i.text })))}
              />
            )}
            {form.start === "template" && (
              <Field label="Plantilla" error={sourceError} hint="Se copia su estructura: los cambios del proyecto no afectan a la plantilla.">
                <Select value={form.sourceId} onChange={(e) => set("sourceId", e.target.value)}>
                  <option value="">Elige una plantilla…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.stages} etapas, {t.activities} actividades)
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {form.start === "project" && (
              <Field label="Proyecto de origen" error={sourceError} hint="Se copian sus etapas, procedimientos, actividades y listas, empezando de cero.">
                <Select value={form.sourceId} onChange={(e) => set("sourceId", e.target.value)}>
                  <option value="">Elige un proyecto…</option>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title} ({o.stagesTotal} etapas)
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </fieldset>
        )}

        <ColorPicker value={form.color} label="Color del proyecto" onChange={(v) => set("color", v ?? DEFAULT_PROJECT_COLOR)} />
        <IconPicker value={form.icon} onChange={(v) => set("icon", v)} />

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={!form.title.trim() || !!dateError || !!budgetError || !!sourceError}>
            {editing ? "Guardar cambios" : "Crear proyecto"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface Item {
  key: string;
  text: string;
  done?: boolean;
}

/** Lista editable de textos (objetivos o etapas iniciales). */
function ListEditor({ legend, hint, placeholder, items, onChange, withDone }: { legend: string; hint: string; placeholder: string; items: Item[]; onChange: (items: Item[]) => void; withDone?: boolean }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([...items, { key: newId(), text, done: false }]);
    setDraft("");
  };
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium text-subtle uppercase tracking-wide">{legend}</legend>
      <p className="text-xs text-subtle">{hint}</p>
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.key} className="flex items-center gap-2">
            {withDone && <input type="checkbox" className="accent-primary h-4 w-4" aria-label="Cumplido" checked={!!it.done} onChange={(e) => onChange(items.map((x) => (x.key === it.key ? { ...x, done: e.target.checked } : x)))} />}
            <Input aria-label={legend} maxLength={withDone ? 300 : 200} value={it.text} onChange={(e) => onChange(items.map((x) => (x.key === it.key ? { ...x, text: e.target.value } : x)))} />
            <button type="button" aria-label="Quitar" className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-md text-subtle hover:bg-muted hover:text-danger" onClick={() => onChange(items.filter((x) => x.key !== it.key))}>
              <X size={16} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          aria-label={placeholder}
          placeholder={placeholder}
          maxLength={withDone ? 300 : 200}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}>
          <Plus size={16} /> Añadir
        </Button>
      </div>
    </fieldset>
  );
}
