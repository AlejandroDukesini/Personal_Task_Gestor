import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select } from "@/components/ui/Input";
import { api } from "@/services/api";
import type { ProjectRow } from "@/services/localDb";
import type { SopSummary } from "@/services/sops/routes";
import type { ProjectSummary } from "@/services/projects/query";
import { runAction } from "@/lib/runAction";

/**
 * Aplicar a un proyecto la estructura de una plantilla SOP o de otro
 * proyecto. Siempre es una copia independiente; se puede añadir al final o
 * sustituir la actual (con confirmación).
 */
export function ApplyStructure({ open, onClose, project, onApplied }: { open: boolean; onClose: () => void; project: ProjectRow; onApplied: (p: ProjectRow) => void }) {
  const [type, setType] = useState<"sop" | "project">("sop");
  const [sourceId, setSourceId] = useState("");
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [templates, setTemplates] = useState<SopSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSourceId("");
    setMode("append");
    api.get<{ items: SopSummary[] }>("/sops?kind=template").then((r) => setTemplates(r.items)).catch(() => setTemplates([]));
    api.get<{ items: ProjectSummary[] }>("/projects?view=all&sort=title&dir=asc").then((r) => setProjects(r.items.filter((p) => p.id !== project.id))).catch(() => setProjects([]));
  }, [open, project.id]);

  async function apply() {
    if (!sourceId) return;
    if (mode === "replace" && project.stages.length && !confirm(`Se sustituirán las ${project.stages.length} etapas actuales (con sus procedimientos, actividades y avances). ¿Continuar?`)) return;
    setBusy(true);
    let next: ProjectRow | null = null;
    const ok = await runAction(
      async () => {
        next = await api.post<ProjectRow>(`/projects/${project.id}/structure`, { from: { type, id: sourceId }, mode });
      },
      "Estructura aplicada",
      () => undefined
    );
    setBusy(false);
    if (ok && next) {
      onApplied(next);
      onClose();
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Aplicar una estructura" description="Se copia con identificadores nuevos: los cambios posteriores no afectan al origen." size="md">
      <div className="space-y-3">
        <Field label="Origen">
          <Select value={type} onChange={(e) => { setType(e.target.value as "sop" | "project"); setSourceId(""); }}>
            <option value="sop">Plantilla SOP</option>
            <option value="project">Otro proyecto</option>
          </Select>
        </Field>
        <Field label={type === "sop" ? "Plantilla" : "Proyecto"}>
          <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">Elige…</option>
            {type === "sop"
              ? templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.stages} etapas)</option>)
              : projects.map((p) => <option key={p.id} value={p.id}>{p.title} ({p.stagesTotal} etapas)</option>)}
          </Select>
        </Field>
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-subtle uppercase tracking-wide mb-1">Cómo aplicarla</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="mode" className="accent-primary" checked={mode === "append"} onChange={() => setMode("append")} /> Añadir sus etapas al final
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="mode" className="accent-primary" checked={mode === "replace"} onChange={() => setMode("replace")} /> Sustituir la estructura actual
          </label>
        </fieldset>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} disabled={!sourceId} onClick={apply}>Aplicar</Button>
        </div>
      </div>
    </Dialog>
  );
}
