import { useEffect, useId, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Plus, X } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { ColorPicker, IconPicker } from "@/components/notes/pickers";
import { errorMessage } from "@/components/finance/shared";
import { api } from "@/services/api";
import { newId, type ProjectObjective, type ProjectRow, type ProjectStatus } from "@/services/localDb";
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
});

/**
 * Crear o editar un proyecto. Nada se escribe hasta pulsar «Guardar»:
 * cancelar (o cerrar) no toca los datos, y si había cambios se pide confirmación.
 */
export function ProjectForm({ open, onClose, project, tags, onSaved }: { open: boolean; onClose: () => void; project?: ProjectRow | null; tags: string[]; onSaved: (p: ProjectRow) => void }) {
  const editing = !!project;
  const [form, setForm] = useState<Form>(() => formOf(project));
  const [busy, setBusy] = useState(false);
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
    setForm(f);
    initial.current = JSON.stringify(f);
    idRef.current = newId();
  }, [open]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = () => JSON.stringify(form) !== initial.current;
  const dateError = form.startDate && form.endDate && form.endDate < form.startDate ? "La fecha final prevista no puede ser anterior a la de inicio" : null;

  function close() {
    if (busy) return;
    if (dirty() && !confirm("¿Descartar los cambios sin guardar?")) return;
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || dateError) return;
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
    };
    try {
      const saved = editing
        ? await api.put<ProjectRow>(`/projects/${project!.id}`, body)
        : await api.post<ProjectRow>("/projects", { ...body, id: idRef.current, stages: form.stages.filter((s) => s.title.trim()).map((s) => ({ title: s.title.trim() })) });
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
          <ListEditor
            legend="Etapas iniciales (opcional)"
            hint="Empiezan al 0 %. Podrás añadir, editar y reordenar etapas después."
            placeholder="Nueva etapa"
            items={form.stages.map((s) => ({ key: s.key, text: s.title }))}
            onChange={(items) => set("stages", items.map((i) => ({ key: i.key, title: i.text })))}
          />
        )}

        <ColorPicker value={form.color} label="Color del proyecto" onChange={(v) => set("color", v ?? DEFAULT_PROJECT_COLOR)} />
        <IconPicker value={form.icon} onChange={(v) => set("icon", v)} />

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={!form.title.trim() || !!dateError}>
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
