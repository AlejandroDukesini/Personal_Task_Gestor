/**
 * Rutas locales del módulo SOP (procedimientos operativos estándar y
 * plantillas). Mismo patrón que proyectos y notas:
 *
 * - Toda escritura pasa por `mutate` (atómica).
 * - La estructura (etapas, procedimientos, actividades, listas) vive dentro
 *   de la fila y se modifica con operaciones validadas (`/ops`).
 * - Copiar (duplicar, guardar como plantilla, crear desde plantilla o desde un
 *   proyecto) genera SIEMPRE ids nuevos: la copia es independiente.
 * - Archivar es reversible; eliminar es definitivo (con copia automática
 *   previa, ver `backup.ts#DESTRUCTIVE`) y deja lápida para la sincronización.
 */

import { ApiError, loadDb, mutate, newId, nowIso, tombstone, type Db, type SopKind, type SopRow, type WfStage } from "@/services/localDb";
import { created, find, ok, parse, type Route } from "@/services/routeKit";
import { fold } from "@/services/notes/query";
import { cloneStages, normalizeStage, structureStats } from "@/services/workflow/logic";
import { applyOp } from "@/services/workflow/ops";
import { structureOp } from "@/services/workflow/schemas";
import { duplicateInput, sopInput, sopPatch } from "./schemas";

export const DEFAULT_SOP_COLOR = "#6366f1";
export const KIND_LABEL: Record<SopKind, string> = { sop: "SOP", template: "Plantilla" };

const orNull = (v: string | null | undefined) => (v ? v : null);

function uniqueName(db: Db, kind: SopKind, name: string, exceptId?: string) {
  if (db.sops.some((s) => s.id !== exceptId && s.kind === kind && s.name.toLowerCase() === name.toLowerCase())) {
    throw new ApiError(409, kind === "template" ? "Ya existe una plantilla con ese nombre" : "Ya existe un SOP con ese nombre");
  }
}

/** Nombre libre para una copia: «X (copia)», «X (copia 2)»… */
function freeName(db: Db, kind: SopKind, base: string): string {
  const taken = (n: string) => db.sops.some((s) => s.kind === kind && s.name.toLowerCase() === n.toLowerCase());
  if (!taken(base)) return base;
  for (let i = 1; ; i++) {
    const n = `${base} (copia${i > 1 ? ` ${i}` : ""})`.slice(0, 200);
    if (!taken(n)) return n;
  }
}

/** Estructura de origen (de un SOP/plantilla o de un proyecto). */
export function sourceStages(db: Db, from: { type: "sop" | "project"; id: string }): WfStage[] {
  if (from.type === "sop") return find(db.sops, from.id, "Plantilla o SOP").stages;
  const p = find(db.projects, from.id, "Proyecto");
  return p.stages.map(normalizeStage);
}

export type SopSummary = Omit<SopRow, "stages"> & ReturnType<typeof structureStats>;

export function summarizeSop(s: SopRow): SopSummary {
  const { stages, ...rest } = s;
  return { ...rest, ...structureStats(stages) };
}

export const sopRoutes: Route[] = [
  /** Lista: `kind` (sop | template), `status` (active = no archivados | archived | all) y búsqueda. */
  ["GET", "/sops", ({ query }) => {
    const db = loadDb();
    const kind = (query.get("kind") as SopKind | null) ?? "sop";
    const status = query.get("status") ?? "active";
    const words = fold(query.get("q") ?? "").split(/\s+/).filter(Boolean);
    const mine = db.sops.filter((s) => s.kind === kind);
    const items = mine
      .filter((s) => (status === "archived" ? s.status === "archived" : status === "all" ? true : s.status !== "archived"))
      .filter((s) => {
        if (!words.length) return true;
        const hay = fold([s.name, s.description ?? "", s.objective ?? "", s.category ?? "", s.owner ?? "", ...s.stages.map((x) => x.title)].join("\n"));
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true }))
      .map(summarizeSop);
    const categories = [...new Set(db.sops.map((s) => s.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "es"));
    return ok({
      items,
      counts: { sop: db.sops.filter((s) => s.kind === "sop" && s.status !== "archived").length, template: db.sops.filter((s) => s.kind === "template" && s.status !== "archived").length, archived: db.sops.filter((s) => s.kind === kind && s.status === "archived").length },
      categories,
    });
  }],
  ["GET", "/sops/:id", ({ params }) => ok(find(loadDb().sops, params.id, "SOP"))],

  ["POST", "/sops", ({ body }) => {
    const data = parse(sopInput, body);
    return created(
      mutate((db) => {
        if (data.id) {
          const existing = db.sops.find((s) => s.id === data.id);
          if (existing) return existing;
        }
        const kind = data.kind ?? "sop";
        uniqueName(db, kind, data.name);
        const ts = nowIso();
        const row: SopRow = {
          id: data.id ?? newId(),
          kind,
          name: data.name,
          description: orNull(data.description),
          objective: orNull(data.objective),
          category: orNull(data.category),
          version: data.version ?? "1.0",
          status: data.status ?? "active",
          owner: orNull(data.owner),
          color: data.color ?? DEFAULT_SOP_COLOR,
          stages: data.from ? cloneStages(sourceStages(db, data.from), ts) : [],
          createdAt: ts,
          updatedAt: ts,
        };
        db.sops.push(row);
        return row;
      })
    );
  }],
  ["PUT", "/sops/:id", ({ params, body }) => {
    const data = parse(sopPatch, body);
    return ok(
      mutate((db) => {
        const s = find(db.sops, params.id, "SOP");
        if (s.status === "archived") throw new ApiError(409, "Está archivado: restáuralo para editarlo");
        if (data.name !== undefined) {
          uniqueName(db, s.kind, data.name, s.id);
          s.name = data.name;
        }
        if (data.description !== undefined) s.description = orNull(data.description);
        if (data.objective !== undefined) s.objective = orNull(data.objective);
        if (data.category !== undefined) s.category = orNull(data.category);
        if (data.version !== undefined) s.version = data.version;
        if (data.status !== undefined) s.status = data.status;
        if (data.owner !== undefined) s.owner = orNull(data.owner);
        if (data.color !== undefined) s.color = data.color;
        s.updatedAt = nowIso();
        return s;
      })
    );
  }],
  /**
   * Copia independiente: duplicar (mismo tipo), guardar un SOP como plantilla
   * (`kind: template`) o crear un SOP desde una plantilla (`kind: sop`).
   * La estructura empieza de cero (sin avances ni casillas marcadas).
   */
  ["POST", "/sops/:id/duplicate", ({ params, body }) => {
    const data = parse(duplicateInput, body ?? {});
    return created(
      mutate((db) => {
        const src = find(db.sops, params.id, "SOP");
        const kind = data.kind ?? src.kind;
        const ts = nowIso();
        const name = data.name ?? freeName(db, kind, kind === src.kind ? `${src.name} (copia)` : src.name);
        uniqueName(db, kind, name);
        const row: SopRow = { ...structuredClone(src), id: newId(), kind, name, status: "active", version: kind === src.kind ? src.version : "1.0", stages: cloneStages(src.stages, ts), createdAt: ts, updatedAt: ts };
        db.sops.push(row);
        return row;
      })
    );
  }],
  ["POST", "/sops/:id/archive", ({ params }) =>
    ok(
      mutate((db) => {
        const s = find(db.sops, params.id, "SOP");
        s.status = "archived";
        s.updatedAt = nowIso();
        return s;
      })
    ),
  ],
  ["POST", "/sops/:id/restore", ({ params }) =>
    ok(
      mutate((db) => {
        const s = find(db.sops, params.id, "SOP");
        if (s.status === "archived") s.status = "active";
        s.updatedAt = nowIso();
        return s;
      })
    ),
  ],
  ["DELETE", "/sops/:id", ({ params }) =>
    ok(
      mutate((db) => {
        const s = find(db.sops, params.id, "SOP");
        db.sops = db.sops.filter((x) => x.id !== s.id);
        tombstone(db, "sops", s.id);
        return { ok: true };
      })
    ),
  ],
  /** Cambios en la estructura: crear, editar, borrar y reordenar en todos los niveles. */
  ["POST", "/sops/:id/ops", ({ params, body }) => {
    const op = parse(structureOp, body);
    return ok(
      mutate((db) => {
        const s = find(db.sops, params.id, "SOP");
        if (s.status === "archived") throw new ApiError(409, "Está archivado: restáuralo para editarlo");
        const ts = nowIso();
        const r = applyOp(s.stages, op, ts);
        s.stages = r.stages;
        s.updatedAt = ts;
        return { sop: s, createdId: r.createdId ?? null };
      })
    );
  }],
];
