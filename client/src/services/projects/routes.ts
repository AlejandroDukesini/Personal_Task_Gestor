/**
 * Rutas locales del módulo de proyectos (mismo patrón que notas).
 *
 * - Toda escritura pasa por `mutate` (atómica: si algo falla, no se escribe nada).
 * - Las etapas y los objetivos viven dentro del proyecto: no hay huérfanos.
 * - El progreso general no se guarda; se deriva de las etapas al leer.
 * - Borrar un proyecto lo manda a la papelera (`deletedAt`); solo «eliminar
 *   definitivamente» lo quita (con sus etapas) y deja una lápida.
 */

import { ApiError, kindOf, localDateKey, loadDb, mutate, newId, nowIso, tombstone, type Db, type ProjectObjective, type ProjectRow, type ProjectStage } from "@/services/localDb";
import { created, find, noContent, ok, parse, type Route } from "@/services/routeKit";
import { NOTE_COLORS } from "@/services/notes/icons";
import { queryProjects, type ProjectQuery } from "./query";
import { applyStructureInput, kindInput, MAX_STAGES, projectInput, projectPatch, reorderInput, stageInput, stagePatch } from "./schemas";
import { cloneStages } from "@/services/workflow/logic";
import { applyOp } from "@/services/workflow/ops";
import { structureOp } from "@/services/workflow/schemas";
import { sourceStages } from "@/services/sops/routes";
import type { z } from "zod";

export const DEFAULT_PROJECT_ICON = "FolderKanban";
export const DEFAULT_PROJECT_COLOR = NOTE_COLORS[7];

function activeProject(db: Db, id: string): ProjectRow {
  const p = find(db.projects, id, "Proyecto");
  if (p.deletedAt) throw new ApiError(409, "El proyecto está en la papelera: restáuralo para editarlo");
  return p;
}

function checkDates(start: string | null, end: string | null) {
  if (start && end && end < start) throw new ApiError(400, "La fecha final prevista no puede ser anterior a la de inicio");
}

function objectivesOf(input: z.infer<typeof projectInput>["objectives"]): ProjectObjective[] {
  const seen = new Set<string>();
  return (input ?? []).map((o) => {
    const id = o.id && !seen.has(o.id) ? o.id : newId();
    seen.add(id);
    return { id, text: o.text, done: o.done ?? false };
  });
}

function findStage(p: ProjectRow, stageId: string): ProjectStage {
  return find(p.stages, stageId, "Etapa");
}

function readQuery(params: URLSearchParams): ProjectQuery {
  return {
    q: params.get("q") ?? undefined,
    view: (params.get("view") as ProjectQuery["view"]) ?? "all",
    kind: params.get("kind") === "personal" ? "personal" : params.get("kind") === "professional" ? "professional" : undefined,
    tag: params.get("tag") ?? undefined,
    sort: (params.get("sort") as ProjectQuery["sort"]) ?? "updated",
    dir: params.get("dir") === "asc" ? "asc" : "desc",
  };
}

export const projectRoutes: Route[] = [
  ["GET", "/projects", ({ query }) => {
    const db = loadDb();
    const q = readQuery(query);
    // Contadores y etiquetas de la sección pedida (o de todas si no se indica).
    const inSection = q.kind ? db.projects.filter((p) => kindOf(p) === q.kind) : db.projects;
    const alive = inSection.filter((p) => !p.deletedAt);
    const counts = {
      all: alive.length,
      active: alive.filter((p) => p.status === "active").length,
      inactive: alive.filter((p) => p.status === "inactive").length,
      finished: alive.filter((p) => p.status === "finished").length,
      trash: inSection.length - alive.length,
    };
    const tags = [...new Set(alive.map((p) => p.tag).filter((t): t is string => !!t))].sort((a, b) => a.localeCompare(b, "es"));
    return ok({ items: queryProjects(db.projects, localDateKey(), q), counts, tags });
  }],
  ["GET", "/projects/:id", ({ params }) => ok(find(loadDb().projects, params.id, "Proyecto"))],
  ["POST", "/projects", ({ body }) => {
    const data = parse(projectInput, body);
    checkDates(data.startDate ?? null, data.endDate ?? null);
    return created(
      mutate((db) => {
        // Id opcional del cliente: crear dos veces lo mismo (doble clic) es idempotente.
        if (data.id) {
          const existing = db.projects.find((p) => p.id === data.id);
          if (existing) return existing;
        }
        const ts = nowIso();
        const status = data.status ?? "active";
        if (data.from && data.from.type === "project" && data.from.id === data.id) throw new ApiError(400, "Origen no válido");
        const copied = data.from ? cloneStages(sourceStages(db, data.from), ts) : null;
        const row: ProjectRow = {
          id: data.id ?? newId(),
          title: data.title,
          icon: data.icon ?? DEFAULT_PROJECT_ICON,
          color: data.color ?? DEFAULT_PROJECT_COLOR,
          tag: data.tag || null,
          startDate: data.startDate ?? null,
          endDate: data.endDate ?? null,
          description: data.description || null,
          status,
          finishedAt: status === "finished" ? ts : null,
          objectives: objectivesOf(data.objectives),
          stages: copied ?? (data.stages ?? []).map((s) => ({ id: newId(), title: s.title, description: null, progress: 0, createdAt: ts, updatedAt: ts })),
          client: data.client || null,
          owner: data.owner || null,
          priority: data.priority ?? null,
          budget: data.budget ?? null,
          sourceTemplateId: data.from?.type === "sop" ? data.from.id : null,
          kind: data.kind ?? "professional",
          deletedAt: null,
          createdAt: ts,
          updatedAt: ts,
        };
        db.projects.push(row);
        return row;
      })
    );
  }],
  ["PUT", "/projects/:id", ({ params, body }) => {
    const data = parse(projectPatch, body);
    return ok(
      mutate((db) => {
        const p = activeProject(db, params.id);
        checkDates(data.startDate !== undefined ? data.startDate : p.startDate, data.endDate !== undefined ? data.endDate : p.endDate);
        const ts = nowIso();
        if (data.title !== undefined) p.title = data.title;
        if (data.icon !== undefined) p.icon = data.icon;
        if (data.color !== undefined) p.color = data.color;
        if (data.tag !== undefined) p.tag = data.tag || null;
        if (data.startDate !== undefined) p.startDate = data.startDate;
        if (data.endDate !== undefined) p.endDate = data.endDate;
        if (data.description !== undefined) p.description = data.description || null;
        if (data.objectives !== undefined) p.objectives = objectivesOf(data.objectives);
        if (data.client !== undefined) p.client = data.client || null;
        if (data.owner !== undefined) p.owner = data.owner || null;
        if (data.priority !== undefined) p.priority = data.priority;
        if (data.budget !== undefined) p.budget = data.budget;
        if (data.status !== undefined && data.status !== p.status) {
          p.status = data.status;
          p.finishedAt = data.status === "finished" ? ts : null;
        }
        p.updatedAt = ts;
        return p;
      })
    );
  }],
  /**
   * Reclasificar (profesional ⇄ personal). Es el MISMO proyecto: mismo id,
   * mismas etapas, actividades, tareas, fechas, estados, prioridades,
   * objetivos, documentación y plantilla de origen. Solo cambian `kind` y
   * `updatedAt` (para que la sincronización propague el cambio). Una sola
   * escritura atómica; repetirla no hace nada.
   */
  ["POST", "/projects/:id/kind", ({ params, body }) => {
    const { kind } = parse(kindInput, body);
    return ok(
      mutate((db) => {
        const p = activeProject(db, params.id);
        if (kindOf(p) !== kind) {
          p.kind = kind;
          p.updatedAt = nowIso();
        }
        return p;
      })
    );
  }],
  // Borrar = mandar a la papelera (recuperable, con sus etapas intactas).
  ["DELETE", "/projects/:id", ({ params }) => {
    mutate((db) => {
      const p = find(db.projects, params.id, "Proyecto");
      if (!p.deletedAt) {
        p.deletedAt = nowIso();
        p.updatedAt = p.deletedAt;
      }
    });
    return noContent();
  }],
  ["POST", "/projects/:id/restore", ({ params }) =>
    ok(
      mutate((db) => {
        const p = find(db.projects, params.id, "Proyecto");
        p.deletedAt = null;
        p.updatedAt = nowIso();
        return p;
      })
    ),
  ],
  ["DELETE", "/projects/:id/purge", ({ params }) => {
    mutate((db) => {
      const p = find(db.projects, params.id, "Proyecto");
      if (!p.deletedAt) throw new ApiError(409, "Solo se eliminan definitivamente los proyectos de la papelera");
      db.projects = db.projects.filter((x) => x.id !== p.id);
      tombstone(db, "projects", p.id);
    });
    return noContent();
  }],
  ["POST", "/projects/trash/empty", () =>
    ok(
      mutate((db) => {
        const gone = db.projects.filter((p) => p.deletedAt);
        db.projects = db.projects.filter((p) => !p.deletedAt);
        for (const p of gone) tombstone(db, "projects", p.id);
        return { purged: gone.length };
      })
    ),
  ],

  /* -------------------------------------------------------------- etapas */
  ["POST", "/projects/:id/stages", ({ params, body }) => {
    const data = parse(stageInput, body);
    return created(
      mutate((db) => {
        const p = activeProject(db, params.id);
        if (p.stages.length >= MAX_STAGES) throw new ApiError(400, `Máximo ${MAX_STAGES} etapas por proyecto`);
        const ts = nowIso();
        const stage: ProjectStage = { id: newId(), title: data.title, description: data.description || null, progress: data.progress ?? 0, createdAt: ts, updatedAt: ts };
        p.stages.push(stage);
        p.updatedAt = ts;
        return { project: p, stage };
      })
    );
  }],
  ["PUT", "/projects/:id/stages/:stageId", ({ params, body }) => {
    const data = parse(stagePatch, body);
    return ok(
      mutate((db) => {
        const p = activeProject(db, params.id);
        const s = findStage(p, params.stageId);
        if (data.progress !== undefined && data.progress !== s.progress && s.activities?.length) {
          throw new ApiError(400, "El avance de esta etapa se calcula a partir de sus actividades");
        }
        if (data.title !== undefined) s.title = data.title;
        if (data.description !== undefined) s.description = data.description || null;
        if (data.progress !== undefined) s.progress = data.progress;
        s.updatedAt = nowIso();
        p.updatedAt = s.updatedAt;
        return { project: p, stage: s };
      })
    );
  }],
  ["DELETE", "/projects/:id/stages/:stageId", ({ params }) =>
    ok(
      mutate((db) => {
        const p = activeProject(db, params.id);
        findStage(p, params.stageId);
        p.stages = p.stages.filter((s) => s.id !== params.stageId);
        p.updatedAt = nowIso();
        return p;
      })
    ),
  ],
  /** Nuevo orden: debe nombrar exactamente las etapas actuales. */
  ["POST", "/projects/:id/stages/reorder", ({ params, body }) => {
    const { ids } = parse(reorderInput, body);
    return ok(
      mutate((db) => {
        const p = activeProject(db, params.id);
        const byId = new Map(p.stages.map((s) => [s.id, s]));
        if (ids.length !== p.stages.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) {
          throw new ApiError(409, "El orden no coincide con las etapas actuales: recarga el proyecto");
        }
        p.stages = ids.map((id) => byId.get(id)!);
        p.updatedAt = nowIso();
        return p;
      })
    );
  }],

  /* ------------------------------------------- sistema de trabajo (v12) */
  /** Operaciones sobre la estructura: etapas, procedimientos, actividades y listas. */
  ["POST", "/projects/:id/ops", ({ params, body }) => {
    const op = parse(structureOp, body);
    return ok(
      mutate((db) => {
        const p = activeProject(db, params.id);
        const ts = nowIso();
        const r = applyOp(p.stages, op, ts);
        p.stages = r.stages;
        p.updatedAt = ts;
        return { project: p, createdId: r.createdId ?? null };
      })
    );
  }],
  /**
   * Aplicar una plantilla (o la estructura de otro proyecto): copia
   * independiente con ids nuevos, al final o sustituyendo la actual.
   */
  ["POST", "/projects/:id/structure", ({ params, body }) => {
    const { from, mode } = parse(applyStructureInput, body);
    return ok(
      mutate((db) => {
        const p = activeProject(db, params.id);
        if (from.type === "project" && from.id === p.id) throw new ApiError(400, "Elige otro proyecto como origen");
        const ts = nowIso();
        const copy = cloneStages(sourceStages(db, from), ts);
        if (mode === "append" && p.stages.length + copy.length > MAX_STAGES) throw new ApiError(400, `Máximo ${MAX_STAGES} etapas por proyecto`);
        p.stages = mode === "replace" ? copy : [...p.stages, ...copy];
        if (from.type === "sop") p.sourceTemplateId = from.id;
        p.updatedAt = ts;
        return p;
      })
    );
  }],
  /** Duplicar un proyecto: mismos datos y estructura, empezando de cero. */
  ["POST", "/projects/:id/duplicate", ({ params }) =>
    created(
      mutate((db) => {
        const src = find(db.projects, params.id, "Proyecto");
        const ts = nowIso();
        const copy: ProjectRow = {
          ...structuredClone(src),
          id: newId(),
          title: `${src.title} (copia)`.slice(0, 200),
          status: "active",
          finishedAt: null,
          objectives: src.objectives.map((o) => ({ ...o, id: newId(), done: false })),
          stages: cloneStages(src.stages, ts),
          deletedAt: null,
          createdAt: ts,
          updatedAt: ts,
        };
        db.projects.push(copy);
        return copy;
      })
    ),
  ],
];
