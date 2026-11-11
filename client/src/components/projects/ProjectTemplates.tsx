import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, FolderPlus, LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Badge } from "@/components/ui/Badge";
import { SopForm } from "@/components/sop/SopForm";
import { api } from "@/services/api";
import type { SopSummary } from "@/services/sops/routes";
import { runAction } from "@/lib/runAction";
import { ActionMenu, MenuItem } from "./shared";

/**
 * Administrador de plantillas de proyecto. Son las plantillas del módulo SOP
 * (una sola biblioteca): se crean, editan, duplican y eliminan aquí o en SOP,
 * y aplicarlas a un proyecto copia su estructura sin tocar el original.
 */
export function ProjectTemplates({ onUse }: { onUse: (templateId: string) => void }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<SopSummary[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<{ items: SopSummary[]; categories: string[] }>("/sops?kind=template");
    setItems(r.items);
    setCategories(r.categories);
  }, []);

  useEffect(() => {
    load().catch(() => setItems([]));
    window.addEventListener("gt:sync-applied", load);
    return () => window.removeEventListener("gt:sync-applied", load);
  }, [load]);

  const act = (fn: () => Promise<unknown>, msg: string) => runAction(fn, msg, load);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-subtle max-w-2xl">Estructuras reutilizables (etapas, procedimientos, actividades y listas). Al usarlas se crea una copia independiente: el proyecto puede cambiar sin alterar la plantilla.</p>
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} /> Nueva plantilla
        </Button>
      </div>
      {!items ? null : items.length === 0 ? (
        <Card>
          <Empty icon={LayoutTemplate} title="Aún no hay plantillas" description="Crea una desde cero o guarda la estructura de un proyecto como plantilla desde su menú." action={<Button onClick={() => setCreating(true)}><Plus size={16} /> Crear plantilla</Button>} />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {items.map((t) => (
            <li key={t.id} className="gt-surface p-4 flex flex-col gap-2 border-l-4" style={{ borderLeftColor: t.color }}>
              <div className="flex items-start gap-2">
                <span className="flex-1 min-w-0 font-medium break-words">{t.name}</span>
                <ActionMenu label={`Acciones de ${t.name}`}>
                  <MenuItem icon={<FolderPlus size={14} />} onClick={() => onUse(t.id)}>Usar en un proyecto nuevo</MenuItem>
                  <MenuItem icon={<Pencil size={14} />} onClick={() => navigate(`/sop/${t.id}`)}>Editar estructura</MenuItem>
                  <MenuItem icon={<Copy size={14} />} onClick={() => act(() => api.post(`/sops/${t.id}/duplicate`), "Plantilla duplicada")}>Duplicar</MenuItem>
                  <MenuItem icon={<Trash2 size={14} />} danger onClick={() => confirm(`¿Eliminar la plantilla «${t.name}»? Los proyectos creados con ella no cambian (se guardará antes una copia de seguridad automática).`) && act(() => api.delete(`/sops/${t.id}`), "Plantilla eliminada")}>Eliminar</MenuItem>
                </ActionMenu>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge>v{t.version}</Badge>
                {t.category && <Badge color={t.color}>{t.category}</Badge>}
              </div>
              {(t.objective || t.description) && <p className="text-sm text-subtle line-clamp-2">{t.objective ?? t.description}</p>}
              <p className="text-xs text-subtle tabular-nums mt-auto">
                {t.stages} etapas · {t.procedures} procedimientos · {t.activities} actividades
              </p>
              <Button size="sm" variant="outline" className="self-start" onClick={() => onUse(t.id)}>
                <FolderPlus size={14} /> Usar en un proyecto
              </Button>
            </li>
          ))}
        </ul>
      )}
      <SopForm open={creating} onClose={() => setCreating(false)} kind="template" categories={categories} onSaved={(s) => navigate(`/sop/${s.id}`)} />
    </div>
  );
}
