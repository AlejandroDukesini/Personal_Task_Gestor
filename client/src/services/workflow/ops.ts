/**
 * Operaciones sobre una estructura de trabajo (etapas de un SOP, una
 * plantilla o un proyecto). Una sola implementación para todos los
 * contenedores: cada ruta carga su fila, aplica la operación con `applyOp`
 * dentro de `mutate` (atómico) y guarda.
 *
 * Reglas que se mantienen siempre:
 * - Los ids no se repiten y los reordenamientos deben nombrar exactamente los
 *   elementos actuales (si no, otro dispositivo cambió algo: 409).
 * - Las dependencias apuntan a actividades del mismo contenedor, nunca a sí
 *   mismas ni forman ciclos; al borrar una actividad o etapa se limpian.
 * - El avance de una etapa con actividades se recalcula tras cada cambio.
 */

import { ApiError, newId, type ProjectStage, type WfActivity, type WfCheckItem, type WfProcedure, type WfStage } from "@/services/localDb";
import { find } from "@/services/routeKit";
import { allActivities, createsCycle, normalizeStage, stageProgressOf } from "./logic";
import { WF_MAX_CHECKS, WF_MAX_ITEMS, WF_MAX_STAGES, type StructureOp } from "./schemas";

const orNull = (v: string | null | undefined) => (v ? v : null);

function reorder<T extends { id: string }>(rows: T[], ids: string[], what: string): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (ids.length !== rows.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) {
    throw new ApiError(409, `El orden no coincide con ${what} actuales: recarga la vista`);
  }
  return ids.map((id) => byId.get(id)!);
}

function checkDates(start: string | null, end: string | null) {
  if (start && end && end < start) throw new ApiError(400, "La fecha final no puede ser anterior a la de inicio");
}

function validDeps(activityId: string, deps: string[], stages: WfStage[]): string[] {
  const all = allActivities(stages);
  const ids = new Set(all.map((a) => a.id));
  const clean = [...new Set(deps)];
  if (clean.includes(activityId)) throw new ApiError(400, "Una actividad no puede depender de sí misma");
  const unknown = clean.find((d) => !ids.has(d));
  if (unknown) throw new ApiError(400, "La dependencia no existe en esta estructura");
  if (createsCycle(activityId, clean, all)) throw new ApiError(400, "Esa dependencia crearía un ciclo");
  return clean;
}

function checklistOf(stages: WfStage[], owner: { stageId: string; procedureId?: string; activityId?: string }): { list: WfCheckItem[]; set: (v: WfCheckItem[]) => void; touch: (ts: string) => void } {
  const stage = find(stages, owner.stageId, "Etapa");
  if (owner.procedureId) {
    const p = find(stage.procedures, owner.procedureId, "Procedimiento");
    return { list: p.checklist, set: (v) => (p.checklist = v), touch: (ts) => (p.updatedAt = ts) };
  }
  if (owner.activityId) {
    const a = find(stage.activities, owner.activityId, "Actividad");
    return { list: a.checklist, set: (v) => (a.checklist = v), touch: (ts) => (a.updatedAt = ts) };
  }
  return { list: stage.checklist, set: (v) => (stage.checklist = v), touch: () => undefined };
}

/** Recalcula el avance de las etapas con actividades. */
function syncProgress(stages: WfStage[]) {
  for (const s of stages) if (s.activities.length) s.progress = stageProgressOf(s);
}

/**
 * Aplica `op` sobre `input` y devuelve la estructura resultante (completa,
 * con los campos por defecto rellenados). No toca `input`: si algo falla,
 * `mutate` descarta el cambio entero.
 */
export function applyOp(input: ProjectStage[], op: StructureOp, ts: string): { stages: WfStage[]; createdId?: string } {
  const stages = structuredClone(input).map(normalizeStage);
  let createdId: string | undefined;
  const stage = (id: string) => find(stages, id, "Etapa");

  switch (op.op) {
    case "stage.add": {
      if (stages.length >= WF_MAX_STAGES) throw new ApiError(400, `Máximo ${WF_MAX_STAGES} etapas`);
      const d = op.data;
      checkDates(d.startDate ?? null, d.endDate ?? null);
      const row: WfStage = {
        id: newId(),
        title: d.title,
        subtitle: orNull(d.subtitle),
        description: orNull(d.description),
        objective: orNull(d.objective),
        color: d.color ?? null,
        startDate: d.startDate ?? null,
        endDate: d.endDate ?? null,
        priority: d.priority ?? null,
        status: d.status ?? null,
        progress: d.progress ?? (d.status === "done" ? 100 : 0),
        procedures: [],
        activities: [],
        checklist: [],
        documentation: orNull(d.documentation),
        observations: orNull(d.observations),
        createdAt: ts,
        updatedAt: ts,
      };
      const idx = op.after ? stages.findIndex((s) => s.id === op.after) : -1;
      stages.splice(idx >= 0 ? idx + 1 : stages.length, 0, row);
      createdId = row.id;
      break;
    }
    case "stage.update": {
      const s = stage(op.stageId);
      const d = op.data;
      checkDates(d.startDate !== undefined ? d.startDate : s.startDate, d.endDate !== undefined ? d.endDate : s.endDate);
      if (d.title !== undefined) s.title = d.title;
      if (d.subtitle !== undefined) s.subtitle = orNull(d.subtitle);
      if (d.description !== undefined) s.description = orNull(d.description);
      if (d.objective !== undefined) s.objective = orNull(d.objective);
      if (d.color !== undefined) s.color = d.color;
      if (d.startDate !== undefined) s.startDate = d.startDate;
      if (d.endDate !== undefined) s.endDate = d.endDate;
      if (d.priority !== undefined) s.priority = d.priority;
      if (d.documentation !== undefined) s.documentation = orNull(d.documentation);
      if (d.observations !== undefined) s.observations = orNull(d.observations);
      if (d.status !== undefined) {
        s.status = d.status;
        // Sin actividades, marcarla completada la deja al 100 % (y reabrirla, por debajo).
        if (!s.activities.length && d.progress === undefined) {
          if (d.status === "done") s.progress = 100;
          else if (s.progress >= 100 && d.status) s.progress = d.status === "pending" ? 0 : 50;
        }
      }
      if (d.progress !== undefined) {
        if (s.activities.length) throw new ApiError(400, "El avance de esta etapa se calcula a partir de sus actividades");
        s.progress = d.progress;
      }
      s.updatedAt = ts;
      break;
    }
    case "stage.delete": {
      const s = stage(op.stageId);
      const gone = new Set(s.activities.map((a) => a.id));
      stages.splice(stages.indexOf(s), 1);
      for (const a of allActivities(stages)) a.dependsOn = a.dependsOn.filter((d) => !gone.has(d));
      break;
    }
    case "stage.duplicate": {
      if (stages.length >= WF_MAX_STAGES) throw new ApiError(400, `Máximo ${WF_MAX_STAGES} etapas`);
      const s = stage(op.stageId);
      const actIds = new Map(s.activities.map((a) => [a.id, newId()]));
      const copy: WfStage = {
        ...structuredClone(s),
        id: newId(),
        title: `${s.title} (copia)`.slice(0, 200),
        procedures: s.procedures.map((p) => ({ ...structuredClone(p), id: newId(), checklist: p.checklist.map((c) => ({ ...c, id: newId() })), createdAt: ts, updatedAt: ts })),
        activities: s.activities.map((a) => ({
          ...structuredClone(a),
          id: actIds.get(a.id)!,
          checklist: a.checklist.map((c) => ({ ...c, id: newId() })),
          // Dentro de la etapa, apuntan a las copias; fuera, al mismo original.
          dependsOn: a.dependsOn.map((d) => actIds.get(d) ?? d),
          createdAt: ts,
          updatedAt: ts,
        })),
        checklist: s.checklist.map((c) => ({ ...c, id: newId() })),
        createdAt: ts,
        updatedAt: ts,
      };
      stages.splice(stages.indexOf(s) + 1, 0, copy);
      createdId = copy.id;
      break;
    }
    case "stage.reorder": {
      const next = reorder(stages, op.ids, "las etapas");
      stages.splice(0, stages.length, ...next);
      break;
    }

    case "procedure.add": {
      const s = stage(op.stageId);
      if (s.procedures.length >= WF_MAX_ITEMS) throw new ApiError(400, `Máximo ${WF_MAX_ITEMS} procedimientos por etapa`);
      const p: WfProcedure = { id: newId(), title: op.data.title, instructions: orNull(op.data.instructions), observations: orNull(op.data.observations), checklist: [], createdAt: ts, updatedAt: ts };
      s.procedures.push(p);
      s.updatedAt = ts;
      createdId = p.id;
      break;
    }
    case "procedure.update": {
      const s = stage(op.stageId);
      const p = find(s.procedures, op.procedureId, "Procedimiento");
      if (op.data.title !== undefined) p.title = op.data.title;
      if (op.data.instructions !== undefined) p.instructions = orNull(op.data.instructions);
      if (op.data.observations !== undefined) p.observations = orNull(op.data.observations);
      p.updatedAt = ts;
      break;
    }
    case "procedure.delete": {
      const s = stage(op.stageId);
      find(s.procedures, op.procedureId, "Procedimiento");
      s.procedures = s.procedures.filter((p) => p.id !== op.procedureId);
      s.updatedAt = ts;
      break;
    }
    case "procedure.reorder": {
      const s = stage(op.stageId);
      s.procedures = reorder(s.procedures, op.ids, "los procedimientos");
      break;
    }

    case "activity.add": {
      const s = stage(op.stageId);
      if (s.activities.length >= WF_MAX_ITEMS) throw new ApiError(400, `Máximo ${WF_MAX_ITEMS} actividades por etapa`);
      const d = op.data;
      const id = newId();
      const status = d.status ?? "pending";
      const a: WfActivity = {
        id,
        title: d.title,
        description: orNull(d.description),
        dueDate: d.dueDate ?? null,
        priority: d.priority ?? "medium",
        status,
        progress: status === "done" ? (d.progress === null ? null : 100) : (d.progress ?? null),
        observations: orNull(d.observations),
        checklist: [],
        dependsOn: [],
        completedAt: status === "done" ? ts : null,
        createdAt: ts,
        updatedAt: ts,
      };
      s.activities.push(a);
      if (d.dependsOn?.length) a.dependsOn = validDeps(id, d.dependsOn, stages);
      s.updatedAt = ts;
      createdId = id;
      break;
    }
    case "activity.update": {
      const s = stage(op.stageId);
      const a = find(s.activities, op.activityId, "Actividad");
      const d = op.data;
      if (d.title !== undefined) a.title = d.title;
      if (d.description !== undefined) a.description = orNull(d.description);
      if (d.dueDate !== undefined) a.dueDate = d.dueDate;
      if (d.priority !== undefined) a.priority = d.priority;
      if (d.observations !== undefined) a.observations = orNull(d.observations);
      if (d.progress !== undefined) a.progress = d.progress;
      if (d.dependsOn !== undefined) a.dependsOn = validDeps(a.id, d.dependsOn, stages);
      if (d.status !== undefined && d.status !== a.status) {
        a.status = d.status;
        a.completedAt = d.status === "done" ? ts : null;
        if (d.status === "done" && a.progress !== null && d.progress === undefined) a.progress = 100;
      }
      a.updatedAt = ts;
      break;
    }
    case "activity.delete": {
      const s = stage(op.stageId);
      find(s.activities, op.activityId, "Actividad");
      s.activities = s.activities.filter((a) => a.id !== op.activityId);
      for (const a of allActivities(stages)) a.dependsOn = a.dependsOn.filter((d) => d !== op.activityId);
      s.updatedAt = ts;
      break;
    }
    case "activity.reorder": {
      const s = stage(op.stageId);
      s.activities = reorder(s.activities, op.ids, "las actividades");
      break;
    }
    case "activity.move": {
      const from = stage(op.stageId);
      const to = stage(op.toStageId);
      if (from === to) break;
      if (to.activities.length >= WF_MAX_ITEMS) throw new ApiError(400, `Máximo ${WF_MAX_ITEMS} actividades por etapa`);
      const a = find(from.activities, op.activityId, "Actividad");
      from.activities = from.activities.filter((x) => x !== a);
      to.activities.push(a);
      a.updatedAt = ts;
      from.updatedAt = ts;
      to.updatedAt = ts;
      break;
    }

    case "check.add": {
      const c = checklistOf(stages, op.owner);
      if (c.list.length >= WF_MAX_CHECKS) throw new ApiError(400, `Máximo ${WF_MAX_CHECKS} elementos por lista`);
      const item = { id: newId(), text: op.text, done: false };
      c.set([...c.list, item]);
      c.touch(ts);
      createdId = item.id;
      break;
    }
    case "check.update": {
      const c = checklistOf(stages, op.owner);
      const item = find(c.list, op.itemId, "Elemento");
      if (op.text !== undefined) item.text = op.text;
      if (op.done !== undefined) item.done = op.done;
      c.touch(ts);
      break;
    }
    case "check.delete": {
      const c = checklistOf(stages, op.owner);
      find(c.list, op.itemId, "Elemento");
      c.set(c.list.filter((x) => x.id !== op.itemId));
      c.touch(ts);
      break;
    }
    case "check.reorder": {
      const c = checklistOf(stages, op.owner);
      c.set(reorder(c.list, op.ids, "la lista"));
      break;
    }
  }

  syncProgress(stages);
  return { stages, createdId };
}
