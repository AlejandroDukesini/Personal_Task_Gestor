import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { SidePanel } from "@/components/ui/SidePanel";
import { ColorPicker } from "@/components/notes/pickers";
import { api } from "@/services/api";
import { newId, type SopKind, type SopRow } from "@/services/localDb";
import { DEFAULT_SOP_COLOR, type SopSummary } from "@/services/sops/routes";
import { runAction as run } from "@/lib/runAction";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Para editar; sin él, crea uno nuevo del tipo `kind`. */
  sop?: SopRow | null;
  kind: SopKind;
  categories: string[];
  onSaved: (s: SopRow) => void;
  /** Plantilla preseleccionada como punto de partida. */
  initialTemplateId?: string;
}

/** Datos generales de un SOP o plantilla (la estructura se edita en su detalle). */
export function SopForm({ open, onClose, sop, kind, categories, onSaved, initialTemplateId }: Props) {
  const [f, setF] = useState({ name: "", description: "", objective: "", category: "", version: "1.0", status: "active" as "draft" | "active", owner: "", color: DEFAULT_SOP_COLOR as string, from: "" });
  const [templates, setTemplates] = useState<SopSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const idRef = useRef(newId());
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    idRef.current = newId();
    setF({
      name: sop?.name ?? "",
      description: sop?.description ?? "",
      objective: sop?.objective ?? "",
      category: sop?.category ?? "",
      version: sop?.version ?? "1.0",
      status: sop?.status === "draft" ? "draft" : "active",
      owner: sop?.owner ?? "",
      color: sop?.color ?? DEFAULT_SOP_COLOR,
      from: initialTemplateId ?? "",
    });
    if (!sop) api.get<{ items: SopSummary[] }>("/sops?kind=template").then((r) => setTemplates(r.items)).catch(() => setTemplates([]));
  }, [open, sop, initialTemplateId]);

  const valid = !!f.name.trim() && !!f.version.trim();

  async function save() {
    if (!valid) return;
    setBusy(true);
    const body = {
      name: f.name.trim(),
      description: f.description.trim() || null,
      objective: f.objective.trim() || null,
      category: f.category.trim() || null,
      version: f.version.trim(),
      status: f.status,
      owner: f.owner.trim() || null,
      color: f.color,
    };
    let saved: SopRow | null = null;
    const ok = await run(
      async () => {
        saved = sop ? await api.put<SopRow>(`/sops/${sop.id}`, body) : await api.post<SopRow>("/sops", { ...body, id: idRef.current, kind, ...(f.from ? { from: { type: "sop", id: f.from } } : {}) });
      },
      sop ? "Cambios guardados" : kind === "template" ? "Plantilla creada" : "SOP creado",
      () => undefined
    );
    setBusy(false);
    if (ok && saved) {
      onSaved(saved);
      onClose();
    }
  }

  const noun = kind === "template" ? "plantilla" : "SOP";
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      width="lg"
      title={sop ? `Editar ${noun}` : kind === "template" ? "Nueva plantilla" : "Nuevo SOP"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} disabled={!valid} onClick={save}>{sop ? "Guardar" : "Crear"}</Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Nombre">
          <Input autoFocus required maxLength={200} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={kind === "template" ? "Ej.: Desarrollo de software" : "Ej.: Cierre contable mensual"} />
        </Field>
        {!sop && (
          <Field label="Empezar desde" hint="Se copia su estructura: los cambios no afectan a la plantilla.">
            <Select value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>
              <option value="">Desde cero</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>Plantilla: {t.name} ({t.stages} etapas)</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Objetivo">
          <Textarea maxLength={5000} value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} placeholder="¿Qué se consigue al seguir este procedimiento?" />
        </Field>
        <Field label="Descripción">
          <Textarea maxLength={20000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoría">
            <Input list={listId} maxLength={60} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Tecnología, Finanzas…" />
          </Field>
          <datalist id={listId}>{categories.map((c) => <option key={c} value={c} />)}</datalist>
          <Field label="Versión">
            <Input required maxLength={30} value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Responsable" hint="Opcional.">
            <Input maxLength={120} value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} />
          </Field>
          <Field label="Estado">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as "draft" | "active" })}>
              <option value="active">Activo</option>
              <option value="draft">Borrador</option>
            </Select>
          </Field>
        </div>
        <ColorPicker value={f.color} label="Color identificador" onChange={(c) => setF({ ...f, color: c ?? DEFAULT_SOP_COLOR })} />
        <button type="submit" hidden />
      </form>
    </SidePanel>
  );
}
