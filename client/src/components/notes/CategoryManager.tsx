import { useState } from "react";
import toast from "react-hot-toast";
import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { api } from "@/services/api";
import type { NoteCategoryRow } from "@/services/localDb";
import { errorMessage } from "@/components/finance/shared";
import { ColorPicker, IconPicker } from "./pickers";
import { NoteIcon } from "./NoteIcon";

export type NoteCategory = NoteCategoryRow & { noteCount: number };

interface Props {
  open: boolean;
  onClose: () => void;
  categories: NoteCategory[];
  reload: () => void;
}

type Form = { id?: string; name: string; color: string; icon: string; parentId: string | null };

export function CategoryManager({ open, onClose, categories, reload }: Props) {
  const [form, setForm] = useState<Form | null>(null);
  const [deleting, setDeleting] = useState<NoteCategory | null>(null);
  const top = categories.filter((c) => !c.parentId);
  const children = (id: string) => categories.filter((c) => c.parentId === id);

  async function save() {
    if (!form) return;
    try {
      const body = { name: form.name, color: form.color, icon: form.icon, parentId: form.parentId };
      if (form.id) await api.put(`/notes/categories/${form.id}`, body);
      else await api.post("/notes/categories", body);
      toast.success(form.id ? "Categoría actualizada" : "Categoría creada");
      setForm(null);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const row = (c: NoteCategory, sub = false) => (
    <li key={c.id} className={sub ? "pl-7" : ""}>
      <div className="flex items-center gap-2 py-1.5">
        {sub && <ChevronRight size={14} className="text-subtle -ml-5" aria-hidden />}
        <span className="h-7 w-7 rounded-md flex items-center justify-center shrink-0" style={{ background: `${c.color}22`, color: c.color }}>
          <NoteIcon name={c.icon} size={15} />
        </span>
        <span className="flex-1 min-w-0 truncate text-sm">{c.name}</span>
        <span className="text-xs text-subtle tabular-nums" title="Notas">
          {c.noteCount}
        </span>
        {!sub && (
          <button className="h-9 w-9 inline-flex items-center justify-center rounded-md text-subtle hover:bg-muted" aria-label={`Añadir subcategoría a ${c.name}`} title="Añadir subcategoría" onClick={() => setForm({ name: "", color: c.color, icon: c.icon, parentId: c.id })}>
            <Plus size={15} />
          </button>
        )}
        <button className="h-9 w-9 inline-flex items-center justify-center rounded-md text-subtle hover:bg-muted" aria-label={`Editar ${c.name}`} onClick={() => setForm({ id: c.id, name: c.name, color: c.color, icon: c.icon, parentId: c.parentId })}>
          <Pencil size={15} />
        </button>
        <button className="h-9 w-9 inline-flex items-center justify-center rounded-md text-subtle hover:bg-muted hover:text-danger" aria-label={`Eliminar ${c.name}`} onClick={() => setDeleting(c)}>
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );

  return (
    <>
    <Dialog open={open && !deleting} onClose={onClose} title="Categorías de notas" description="Organiza tus notas en categorías y subcategorías." size="lg">
      {form ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field label="Nombre">
            <Input required maxLength={60} autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Categoría principal">
            <Select value={form.parentId ?? ""} onChange={(e) => setForm({ ...form, parentId: e.target.value || null })}>
              <option value="">— Ninguna (es una categoría principal) —</option>
              {top
                .filter((c) => c.id !== form.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
          <ColorPicker value={form.color} onChange={(v) => setForm({ ...form, color: v ?? form.color })} />
          <IconPicker value={form.icon} onChange={(v) => setForm({ ...form, icon: v })} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button type="submit">{form.id ? "Guardar" : "Crear"}</Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <Button size="sm" onClick={() => setForm({ name: "", color: "#6366f1", icon: "Tag", parentId: null })}>
            <Plus size={14} /> Nueva categoría
          </Button>
          <ul className="divide-y divide-border">{top.flatMap((c) => [row(c), ...children(c.id).map((s) => row(s, true))])}</ul>
          {categories.length === 0 && <p className="text-sm text-subtle">Aún no hay categorías.</p>}
        </div>
      )}
    </Dialog>
    {deleting && <DeleteCategoryDialog category={deleting} categories={categories} onClose={() => setDeleting(null)} onDone={reload} />}
    </>
  );
}

function DeleteCategoryDialog({ category, categories, onClose, onDone }: { category: NoteCategory; categories: NoteCategory[]; onClose: () => void; onDone: () => void }) {
  const subs = categories.filter((c) => c.parentId === category.id);
  const affected = category.noteCount + subs.reduce((s, c) => s + c.noteCount, 0);
  const removed = new Set([category.id, ...subs.map((s) => s.id)]);
  const targets = categories.filter((c) => !removed.has(c.id));
  const [strategy, setStrategy] = useState<"reassign" | "uncategorize" | "trash">(affected ? "reassign" : "uncategorize");
  const [targetId, setTargetId] = useState(targets.find((t) => !t.parentId)?.id ?? "");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const r = await api.post<{ deleted: number; affectedNotes: number }>(`/notes/categories/${category.id}/delete`, { strategy, targetId: strategy === "reassign" ? targetId : null });
      toast.success(`Categoría eliminada${r.affectedNotes ? ` · ${r.affectedNotes} nota(s) actualizadas` : ""}`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const name = (c: NoteCategory) => (c.parentId ? `${categories.find((p) => p.id === c.parentId)?.name ?? ""} › ${c.name}` : c.name);
  return (
    <Dialog open onClose={onClose} title={`Eliminar «${category.name}»`} size="sm">
      <div className="space-y-3 text-sm">
        <p>
          {subs.length > 0 && <>Se eliminarán también sus {subs.length} subcategoría(s). </>}
          {affected ? <>Tiene <strong>{affected}</strong> nota(s). ¿Qué hacemos con ellas?</> : "No tiene notas."}
        </p>
        {affected > 0 && (
          <fieldset className="space-y-2">
            <legend className="sr-only">Destino de las notas</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="strategy" className="accent-primary mt-1" checked={strategy === "reassign"} onChange={() => setStrategy("reassign")} disabled={!targets.length} />
              <span className="flex-1">
                Moverlas a otra categoría
                {strategy === "reassign" && (
                  <Select aria-label="Categoría de destino" className="mt-1" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {name(t)}
                      </option>
                    ))}
                  </Select>
                )}
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="strategy" className="accent-primary" checked={strategy === "uncategorize"} onChange={() => setStrategy("uncategorize")} />
              {category.parentId ? "Dejarlas solo en la categoría principal" : "Dejarlas sin categoría"}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="strategy" className="accent-primary" checked={strategy === "trash"} onChange={() => setStrategy("trash")} />
              Enviarlas a la papelera (se pueden recuperar)
            </label>
          </fieldset>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={run} loading={busy} disabled={strategy === "reassign" && !targetId}>
            Eliminar categoría
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
