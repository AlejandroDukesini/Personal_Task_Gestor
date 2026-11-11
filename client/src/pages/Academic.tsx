import { useSearchParams } from "react-router-dom";
import { BookOpen, CalendarDays, CalendarRange, GraduationCap, LayoutDashboard, ListChecks, Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Select } from "@/components/ui/Input";
import { useAcademic } from "@/components/academic/shared";
import { SemestersView } from "@/components/academic/SemestersView";
import { SubjectsView } from "@/components/academic/SubjectsView";
import { ScheduleView } from "@/components/academic/ScheduleView";
import { ActivitiesView } from "@/components/academic/ActivitiesView";
import { AcademicOverviewView } from "@/components/academic/OverviewView";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "panel", label: "Panel", icon: LayoutDashboard },
  { id: "actividades", label: "Actividades", icon: ListChecks },
  { id: "horario", label: "Horario", icon: CalendarDays },
  { id: "materias", label: "Materias", icon: BookOpen },
  { id: "semestres", label: "Semestres", icon: CalendarRange },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * Tareas universitarias: un semestre a la vez (el activo por defecto). El
 * semestre y la pestaña viven en la URL para que recargar no pierda el sitio.
 */
export function Academic() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "panel") as TabId;
  const { data, error, reload } = useAcademic(params.get("sem"));

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const semester = data?.semester ?? null;
  const needsSemester = tab !== "semestres" && !semester;

  return (
    <>
      <PageHeader
        title="Tareas universitarias"
        description="Semestres, materias, horario y entregas en un solo lugar."
        actions={
          data && data.semesters.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-subtle hidden sm:inline">Semestre</span>
              <Select aria-label="Semestre" className="w-48" value={semester?.id ?? ""} onChange={(e) => set("sem", e.target.value)}>
                {data.semesters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.active ? " (activo)" : ""}
                  </option>
                ))}
              </Select>
            </label>
          )
        }
      />

      <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-2 mb-4 border-b border-border" aria-label="Secciones académicas">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => set("tab", t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn("flex items-center gap-1.5 px-3 h-9 rounded-md text-sm whitespace-nowrap shrink-0", tab === t.id ? "bg-primary/10 text-primary font-medium" : "text-subtle hover:text-text hover:bg-muted")}
          >
            <t.icon size={15} aria-hidden />
            {t.label}
          </button>
        ))}
      </nav>

      {error ? (
        <Card>
          <Empty title="No se pudo cargar el módulo académico" description={error} action={<Button onClick={reload}>Reintentar</Button>} />
        </Card>
      ) : !data ? (
        <div className="flex justify-center py-16" role="status" aria-label="Cargando">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent opacity-40" />
        </div>
      ) : needsSemester ? (
        <Card>
          <Empty
            icon={GraduationCap}
            title="Empieza creando tu semestre"
            description="Las materias, el horario y las actividades se organizan dentro de un semestre para no mezclar periodos."
            action={
              <Button onClick={() => set("tab", "semestres")}>
                <Plus size={16} /> Crear semestre
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {tab === "semestres" && <SemestersView semesters={data.semesters} selectedId={semester?.id ?? null} onSelect={(id) => set("sem", id)} reload={reload} />}
          {semester && tab === "panel" && <AcademicOverviewView data={data} onGoTab={(t) => set("tab", t)} reload={reload} />}
          {semester && tab === "actividades" && <ActivitiesView data={data} reload={reload} />}
          {semester && tab === "horario" && <ScheduleView data={data} reload={reload} onGoTab={(t) => set("tab", t)} />}
          {semester && tab === "materias" && <SubjectsView data={data} reload={reload} />}
        </>
      )}
    </>
  );
}
