/**
 * Rutas locales de las metas personales (Proyectos › Personal).
 *
 * - Toda escritura pasa por `mutate` (atómica).
 * - Los cambios relevantes (fechas, avance, estado, prioridad…) quedan en el
 *   historial de la meta.
 * - Archivar es reversible; eliminar es definitivo (copia automática previa y
 *   lápida para la sincronización).
 * - Los proyectos NO se convierten en metas: pasan a Personal conservando
 *   todo (`POST /projects/:id/kind`). Las metas creadas con la antigua
 *   conversión pueden recuperar su proyecto original (`recover-project`).
 */

import { ApiError, localDateKey, loadDb, mutate, newId, nowIso, tombstone, type PersonalGoalRow, type PersonalGoalStatus } from "@/services/localDb";
import { created, find, ok, parse, type Route } from "@/services/routeKit";
import { fold } from "@/services/notes/query";
import { NOTE_COLORS } from "@/services/notes/icons";
import { PRIORITY_LABEL } from "@/services/workflow/logic";
import { daysBetween, phaseOf, STATUS_LABEL, timeLeftLabel, yearOf, type GoalPhase } from "./logic";
import { goalInput, goalPatch, MAX_HISTORY } from "./schemas";

export const DEFAULT_GOAL_COLOR = NOTE_COLORS[7];

const orNull = (v: string | null | undefined) => (v ? v : null);

function checkDates(start: string | null, target: string) {
  if (start && target < start) throw new ApiError(400, "La fecha objetivo no puede ser anterior a la de inicio");
}

const fmt = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) : "sin fecha");

function log(g: PersonalGoalRow, text: string, at: string) {
  g.history = [{ at, text: text.slice(0, 300) }, ...g.history].slice(0, MAX_HISTORY);
}

/** Estado coherente con el avance: completar = 100 %; reabrir una completada la deja en curso. */
function applyStatus(g: PersonalGoalRow, status: PersonalGoalStatus, ts: string) {
  if (status === g.status) return;
  g.status = status;
  g.completedAt = status === "completed" ? ts : null;
  if (status === "completed") g.progress = 100;
}

export type GoalView = PersonalGoalRow & { phase: GoalPhase; daysLeft: number; timeLeft: string };

export function viewOf(g: PersonalGoalRow, today: string): GoalView {
  return { ...g, phase: phaseOf(g, today), daysLeft: daysBetween(today, g.targetDate), timeLeft: timeLeftLabel(g.targetDate, today) };
}

export const personalGoalRoutes: Route[] = [
  /** Metas (no archivadas por defecto) con su fase calculada y los años que abarcan. */
  ["GET", "/personal-goals", ({ query }) => {
    const db = loadDb();
    const today = localDateKey();
    const archived = query.get("archived") === "1";
    const words = fold(query.get("q") ?? "").split(/\s+/).filter(Boolean);
    const category = query.get("category");
    const items = db.personalGoals
      .filter((g) => g.archived === archived)
      .filter((g) => !category || g.category === category)
      .filter((g) => !words.length || words.every((w) => fold([g.title, g.description ?? "", g.category ?? "", g.observations ?? ""].join("\n")).includes(w)))
      .sort((a, b) => a.targetDate.localeCompare(b.targetDate) || a.title.localeCompare(b.title, "es"))
      .map((g) => viewOf(g, today));
    const years = [...new Set(items.flatMap((g) => [yearOf(g.targetDate), ...(g.startDate ? [yearOf(g.startDate)] : [])]))].sort((a, b) => a - b);
    const categories = [...new Set(db.personalGoals.map((g) => g.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "es"));
    return ok({ today, items, years, categories, counts: { active: db.personalGoals.filter((g) => !g.archived).length, archived: db.personalGoals.filter((g) => g.archived).length } });
  }],
  ["GET", "/personal-goals/:id", ({ params }) => ok(viewOf(find(loadDb().personalGoals, params.id, "Meta"), localDateKey()))],

  ["POST", "/personal-goals", ({ body }) => {
    const data = parse(goalInput, body);
    checkDates(data.startDate ?? null, data.targetDate);
    return created(
      mutate((db) => {
        if (data.id) {
          const existing = db.personalGoals.find((g) => g.id === data.id);
          if (existing) return existing;
        }
        const ts = nowIso();
        const status = data.status ?? "planned";
        const row: PersonalGoalRow = {
          id: data.id ?? newId(),
          title: data.title,
          description: orNull(data.description),
          category: orNull(data.category),
          color: data.color ?? DEFAULT_GOAL_COLOR,
          priority: data.priority ?? "medium",
          status,
          progress: status === "completed" ? 100 : (data.progress ?? 0),
          startDate: data.startDate ?? null,
          targetDate: data.targetDate,
          observations: orNull(data.observations),
          archived: false,
          completedAt: status === "completed" ? ts : null,
          history: [{ at: ts, text: "Meta creada" }],
          sourceProjectId: null,
          createdAt: ts,
          updatedAt: ts,
        };
        db.personalGoals.push(row);
        return row;
      })
    );
  }],

  ["PUT", "/personal-goals/:id", ({ params, body }) => {
    const data = parse(goalPatch, body);
    return ok(
      mutate((db) => {
        const g = find(db.personalGoals, params.id, "Meta");
        const ts = nowIso();
        const start = data.startDate !== undefined ? data.startDate : g.startDate;
        const target = data.targetDate ?? g.targetDate;
        checkDates(start, target);
        const changes: string[] = [];
        if (data.title !== undefined && data.title !== g.title) {
          changes.push(`Nombre: «${g.title}» → «${data.title}»`);
          g.title = data.title;
        }
        if (data.description !== undefined) g.description = orNull(data.description);
        if (data.category !== undefined && orNull(data.category) !== g.category) {
          changes.push(`Categoría: ${g.category ?? "ninguna"} → ${orNull(data.category) ?? "ninguna"}`);
          g.category = orNull(data.category);
        }
        if (data.color !== undefined && data.color !== g.color) {
          changes.push("Color cambiado");
          g.color = data.color;
        }
        if (data.priority !== undefined && data.priority !== g.priority) {
          changes.push(`Prioridad: ${PRIORITY_LABEL[g.priority]} → ${PRIORITY_LABEL[data.priority]}`);
          g.priority = data.priority;
        }
        if (start !== g.startDate) {
          changes.push(`Inicio: ${fmt(g.startDate)} → ${fmt(start)}`);
          g.startDate = start;
        }
        if (target !== g.targetDate) {
          changes.push(`Fecha objetivo: ${fmt(g.targetDate)} → ${fmt(target)}`);
          g.targetDate = target;
        }
        if (data.observations !== undefined) g.observations = orNull(data.observations);
        const before = { status: g.status, progress: g.progress };
        if (data.progress !== undefined) g.progress = data.progress;
        if (data.status !== undefined) applyStatus(g, data.status, ts);
        // Bajar del 100 % una meta completada la reabre.
        else if (g.status === "completed" && g.progress < 100) applyStatus(g, "in_progress", ts);
        if (g.status !== before.status) changes.push(`Estado: ${STATUS_LABEL[before.status]} → ${STATUS_LABEL[g.status]}`);
        if (g.progress !== before.progress) changes.push(`Avance: ${before.progress} % → ${g.progress} %`);
        for (const c of changes.reverse()) log(g, c, ts);
        g.updatedAt = ts;
        return g;
      })
    );
  }],
  ["POST", "/personal-goals/:id/archive", ({ params }) =>
    ok(
      mutate((db) => {
        const g = find(db.personalGoals, params.id, "Meta");
        if (!g.archived) {
          g.archived = true;
          g.updatedAt = nowIso();
          log(g, "Archivada", g.updatedAt);
        }
        return g;
      })
    ),
  ],
  ["POST", "/personal-goals/:id/unarchive", ({ params }) =>
    ok(
      mutate((db) => {
        const g = find(db.personalGoals, params.id, "Meta");
        if (g.archived) {
          g.archived = false;
          g.updatedAt = nowIso();
          log(g, "Restaurada del archivo", g.updatedAt);
        }
        return g;
      })
    ),
  ],
  ["DELETE", "/personal-goals/:id", ({ params }) =>
    ok(
      mutate((db) => {
        const g = find(db.personalGoals, params.id, "Meta");
        db.personalGoals = db.personalGoals.filter((x) => x.id !== g.id);
        tombstone(db, "personalGoals", g.id);
        return { ok: true };
      })
    ),
  ],

  /**
   * Recuperar el proyecto original de una meta creada con la antigua
   * «Convertir en meta personal» (que copiaba solo título, descripción,
   * fechas y avance y mandaba el proyecto a la papelera). Si el proyecto
   * sigue existiendo (papelera incluida), vuelve íntegro —mismo id, etapas,
   * actividades y tareas— a Proyectos › Personal. La meta NO se borra: se
   * archiva (reversible) para no duplicar. Todo en una sola escritura.
   * Si el proyecto se eliminó definitivamente no hay nada que recuperar.
   */
  ["POST", "/personal-goals/:id/recover-project", ({ params }) =>
    ok(
      mutate((db) => {
        const g = find(db.personalGoals, params.id, "Meta");
        if (!g.sourceProjectId) throw new ApiError(400, "Esta meta no se creó a partir de un proyecto");
        const p = db.projects.find((x) => x.id === g.sourceProjectId);
        if (!p) throw new ApiError(404, "El proyecto original se eliminó definitivamente: no queda información que recuperar");
        const ts = nowIso();
        p.deletedAt = null;
        p.kind = "personal";
        p.updatedAt = ts;
        if (!g.archived) g.archived = true;
        g.updatedAt = ts;
        log(g, `Proyecto original «${p.title}» recuperado en Proyectos › Personal`, ts);
        return { project: p, goal: g };
      })
    ),
  ],
];
