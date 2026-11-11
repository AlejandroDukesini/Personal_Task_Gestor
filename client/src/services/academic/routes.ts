/**
 * Rutas locales del módulo académico (mismo patrón que proyectos y notas).
 *
 * - Toda escritura pasa por `mutate` (atómica: si algo falla, no se escribe nada).
 * - Integridad referencial: una materia pertenece a un semestre; una clase, a
 *   una materia (y a su semestre); una actividad, a un semestre y, si se
 *   indica, a una materia de ESE semestre.
 * - Borrar un semestre o una materia borra en cascada lo que cuelga de ellos
 *   y deja lápidas para la sincronización. Antes, `api.ts` guarda una copia
 *   verificada (ver `backup.ts#DESTRUCTIVE`).
 * - Las clases que se solapan se rechazan con 409 salvo que el usuario
 *   confirme el aviso (`allowOverlap`).
 */

import { ApiError, localDateKey, loadDb, mutate, newId, nowIso, tombstone, type AcadActivityRow, type AcadClassRow, type AcadReference, type AcadSemesterRow, type AcadSubjectRow, type Db } from "@/services/localDb";
import { created, find, ok, parse, type Route } from "@/services/routeKit";
import { NOTE_COLORS } from "@/services/notes/icons";
import type { z } from "zod";
import { conflictingIds, conflictsFor, DAY_LABELS, overviewOf, toMinutes } from "./logic";
import { activityInput, activityPatch, classInput, classPatch, referenceInput, semesterInput, semesterPatch, subjectInput, subjectPatch } from "./schemas";

export const DEFAULT_SUBJECT_COLOR = NOTE_COLORS[7];

const orNull = (v: string | null | undefined) => (v ? v : null);

function checkRange(start: string, end: string, what: string) {
  if (end < start) throw new ApiError(400, `La fecha de finalización ${what} no puede ser anterior a la de inicio`);
}

function checkTimes(start: string, end: string) {
  if (toMinutes(end) <= toMinutes(start)) throw new ApiError(400, "La hora de finalización debe ser posterior a la de inicio");
}

/** Solo un semestre activo a la vez. */
function activate(db: Db, id: string, ts: string) {
  for (const s of db.acadSemesters) {
    const next = s.id === id;
    if (s.active !== next) {
      s.active = next;
      s.updatedAt = ts;
    }
  }
}

function referencesOf(input: z.infer<typeof referenceInput>[] | undefined): AcadReference[] {
  const seen = new Set<string>();
  return (input ?? []).map((r) => {
    const id = r.id && !seen.has(r.id) ? r.id : newId();
    seen.add(id);
    return { id, label: r.label, url: r.url ? r.url : null };
  });
}

function subjectIn(db: Db, subjectId: string | null | undefined, semesterId: string): string | null {
  if (!subjectId) return null;
  const s = find(db.acadSubjects, subjectId, "Materia");
  if (s.semesterId !== semesterId) throw new ApiError(400, "La materia pertenece a otro semestre");
  return s.id;
}

/** Rechaza (409) una franja que se solapa, salvo confirmación explícita. */
function guardOverlap(db: Db, slot: Pick<AcadClassRow, "semesterId" | "day" | "startTime" | "endTime"> & { id?: string }, allow: boolean | undefined) {
  if (allow) return;
  const hits = conflictsFor(slot, db.acadClasses);
  if (!hits.length) return;
  const name = (c: AcadClassRow) => db.acadSubjects.find((s) => s.id === c.subjectId)?.name ?? "otra clase";
  const list = hits.map((c) => `${name(c)} (${c.startTime}–${c.endTime})`).join(", ");
  throw new ApiError(409, `Se solapa el ${DAY_LABELS[slot.day].toLowerCase()} con ${list}`);
}

/** Cascada: borra las filas indicadas de una colección dejando lápida. */
function purge<C extends "acadSubjects" | "acadClasses" | "acadActivities">(db: Db, collection: C, keep: (row: Db[C][number]) => boolean): number {
  const rows = db[collection] as { id: string }[];
  const gone = rows.filter((r) => !keep(r as Db[C][number]));
  (db as any)[collection] = rows.filter((r) => keep(r as Db[C][number]));
  for (const r of gone) tombstone(db, collection, r.id);
  return gone.length;
}

/** Semestre elegido: el pedido, si existe; si no, el activo; si no, el más reciente. */
export function pickSemester(semesters: AcadSemesterRow[], wanted: string | null): AcadSemesterRow | null {
  return semesters.find((s) => s.id === wanted) ?? semesters.find((s) => s.active) ?? [...semesters].sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ?? null;
}

export const academicRoutes: Route[] = [
  /** Todo lo de un semestre en una lectura (las vistas filtran en memoria). */
  ["GET", "/academic", ({ query }) => {
    const db = loadDb();
    const today = localDateKey();
    const semester = pickSemester(db.acadSemesters, query.get("semesterId"));
    const semesters = [...db.acadSemesters]
      .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.name.localeCompare(b.name, "es"))
      .map((s) => ({
        ...s,
        subjectCount: db.acadSubjects.filter((x) => x.semesterId === s.id).length,
        activityCount: db.acadActivities.filter((x) => x.semesterId === s.id).length,
        classCount: db.acadClasses.filter((x) => x.semesterId === s.id).length,
      }));
    if (!semester) return ok({ today, semesters, semester: null, subjects: [], classes: [], activities: [], conflicts: [], overview: null });
    const subjects = db.acadSubjects.filter((s) => s.semesterId === semester.id).sort((a, b) => a.name.localeCompare(b.name, "es"));
    const classes = db.acadClasses.filter((c) => c.semesterId === semester.id);
    const activities = db.acadActivities.filter((a) => a.semesterId === semester.id);
    return ok({
      today,
      semesters,
      semester,
      subjects,
      classes,
      activities,
      conflicts: [...conflictingIds(classes)],
      overview: overviewOf(activities, classes, today),
    });
  }],

  /* ------------------------------------------------------------ semestres */
  ["POST", "/academic/semesters", ({ body }) => {
    const data = parse(semesterInput, body);
    checkRange(data.startDate, data.endDate, "del semestre");
    return created(
      mutate((db) => {
        if (data.id) {
          const existing = db.acadSemesters.find((s) => s.id === data.id);
          if (existing) return existing;
        }
        if (db.acadSemesters.some((s) => s.name.toLowerCase() === data.name.toLowerCase())) throw new ApiError(409, "Ya existe un semestre con ese nombre");
        const ts = nowIso();
        const row: AcadSemesterRow = {
          id: data.id ?? newId(),
          name: data.name,
          startDate: data.startDate,
          endDate: data.endDate,
          // El primero queda activo: así el panel tiene algo que mostrar.
          active: false,
          notes: orNull(data.notes),
          createdAt: ts,
          updatedAt: ts,
        };
        db.acadSemesters.push(row);
        if (data.active || db.acadSemesters.length === 1) activate(db, row.id, ts);
        return row;
      })
    );
  }],
  ["PUT", "/academic/semesters/:id", ({ params, body }) => {
    const data = parse(semesterPatch, body);
    return ok(
      mutate((db) => {
        const s = find(db.acadSemesters, params.id, "Semestre");
        checkRange(data.startDate ?? s.startDate, data.endDate ?? s.endDate, "del semestre");
        if (data.name !== undefined && db.acadSemesters.some((x) => x.id !== s.id && x.name.toLowerCase() === data.name!.toLowerCase())) {
          throw new ApiError(409, "Ya existe un semestre con ese nombre");
        }
        const ts = nowIso();
        if (data.name !== undefined) s.name = data.name;
        if (data.startDate !== undefined) s.startDate = data.startDate;
        if (data.endDate !== undefined) s.endDate = data.endDate;
        if (data.notes !== undefined) s.notes = orNull(data.notes);
        s.updatedAt = ts;
        if (data.active === true) activate(db, s.id, ts);
        else if (data.active === false && s.active) s.active = false;
        return s;
      })
    );
  }],
  ["POST", "/academic/semesters/:id/activate", ({ params }) =>
    ok(
      mutate((db) => {
        const s = find(db.acadSemesters, params.id, "Semestre");
        activate(db, s.id, nowIso());
        return s;
      })
    ),
  ],
  ["DELETE", "/academic/semesters/:id", ({ params }) =>
    ok(
      mutate((db) => {
        const s = find(db.acadSemesters, params.id, "Semestre");
        const removed = {
          subjects: purge(db, "acadSubjects", (x) => x.semesterId !== s.id),
          classes: purge(db, "acadClasses", (x) => x.semesterId !== s.id),
          activities: purge(db, "acadActivities", (x) => x.semesterId !== s.id),
        };
        db.acadSemesters = db.acadSemesters.filter((x) => x.id !== s.id);
        tombstone(db, "acadSemesters", s.id);
        return removed;
      })
    ),
  ],

  /* -------------------------------------------------------------- materias */
  ["POST", "/academic/subjects", ({ body }) => {
    const data = parse(subjectInput, body);
    return created(
      mutate((db) => {
        if (data.id) {
          const existing = db.acadSubjects.find((s) => s.id === data.id);
          if (existing) return existing;
        }
        const sem = find(db.acadSemesters, data.semesterId, "Semestre");
        if (db.acadSubjects.some((s) => s.semesterId === sem.id && s.name.toLowerCase() === data.name.toLowerCase())) {
          throw new ApiError(409, "Ya existe una materia con ese nombre en este semestre");
        }
        const ts = nowIso();
        const row: AcadSubjectRow = {
          id: data.id ?? newId(),
          semesterId: sem.id,
          name: data.name,
          code: orNull(data.code),
          professor: orNull(data.professor),
          professorContact: orNull(data.professorContact),
          room: orNull(data.room),
          credits: data.credits ?? null,
          description: orNull(data.description),
          color: data.color ?? DEFAULT_SUBJECT_COLOR,
          createdAt: ts,
          updatedAt: ts,
        };
        db.acadSubjects.push(row);
        return row;
      })
    );
  }],
  ["PUT", "/academic/subjects/:id", ({ params, body }) => {
    const data = parse(subjectPatch, body);
    return ok(
      mutate((db) => {
        const s = find(db.acadSubjects, params.id, "Materia");
        if (data.name !== undefined && db.acadSubjects.some((x) => x.id !== s.id && x.semesterId === s.semesterId && x.name.toLowerCase() === data.name!.toLowerCase())) {
          throw new ApiError(409, "Ya existe una materia con ese nombre en este semestre");
        }
        if (data.name !== undefined) s.name = data.name;
        if (data.code !== undefined) s.code = orNull(data.code);
        if (data.professor !== undefined) s.professor = orNull(data.professor);
        if (data.professorContact !== undefined) s.professorContact = orNull(data.professorContact);
        if (data.room !== undefined) s.room = orNull(data.room);
        if (data.credits !== undefined) s.credits = data.credits;
        if (data.description !== undefined) s.description = orNull(data.description);
        if (data.color !== undefined) s.color = data.color;
        s.updatedAt = nowIso();
        return s;
      })
    );
  }],
  ["DELETE", "/academic/subjects/:id", ({ params }) =>
    ok(
      mutate((db) => {
        const s = find(db.acadSubjects, params.id, "Materia");
        const removed = {
          classes: purge(db, "acadClasses", (x) => x.subjectId !== s.id),
          activities: purge(db, "acadActivities", (x) => x.subjectId !== s.id),
        };
        db.acadSubjects = db.acadSubjects.filter((x) => x.id !== s.id);
        tombstone(db, "acadSubjects", s.id);
        return removed;
      })
    ),
  ],

  /* --------------------------------------------------------------- horario */
  ["POST", "/academic/classes", ({ body }) => {
    const data = parse(classInput, body);
    checkTimes(data.startTime, data.endTime);
    return created(
      mutate((db) => {
        if (data.id) {
          const existing = db.acadClasses.find((c) => c.id === data.id);
          if (existing) return existing;
        }
        const subject = find(db.acadSubjects, data.subjectId, "Materia");
        const slot = { semesterId: subject.semesterId, day: data.day, startTime: data.startTime, endTime: data.endTime };
        guardOverlap(db, slot, data.allowOverlap);
        const ts = nowIso();
        const row: AcadClassRow = {
          id: data.id ?? newId(),
          ...slot,
          subjectId: subject.id,
          professor: orNull(data.professor),
          room: orNull(data.room),
          createdAt: ts,
          updatedAt: ts,
        };
        db.acadClasses.push(row);
        return row;
      })
    );
  }],
  ["PUT", "/academic/classes/:id", ({ params, body }) => {
    const data = parse(classPatch, body);
    return ok(
      mutate((db) => {
        const c = find(db.acadClasses, params.id, "Clase");
        const subject = data.subjectId ? find(db.acadSubjects, data.subjectId, "Materia") : find(db.acadSubjects, c.subjectId, "Materia");
        if (subject.semesterId !== c.semesterId) throw new ApiError(400, "La materia pertenece a otro semestre");
        const next = { id: c.id, semesterId: c.semesterId, day: data.day ?? c.day, startTime: data.startTime ?? c.startTime, endTime: data.endTime ?? c.endTime };
        checkTimes(next.startTime, next.endTime);
        guardOverlap(db, next, data.allowOverlap);
        c.subjectId = subject.id;
        c.day = next.day;
        c.startTime = next.startTime;
        c.endTime = next.endTime;
        if (data.professor !== undefined) c.professor = orNull(data.professor);
        if (data.room !== undefined) c.room = orNull(data.room);
        c.updatedAt = nowIso();
        return c;
      })
    );
  }],
  ["DELETE", "/academic/classes/:id", ({ params }) =>
    ok(
      mutate((db) => {
        find(db.acadClasses, params.id, "Clase");
        purge(db, "acadClasses", (x) => x.id !== params.id);
        return { ok: true };
      })
    ),
  ],

  /* ----------------------------------------------------------- actividades */
  ["POST", "/academic/activities", ({ body }) => {
    const data = parse(activityInput, body);
    return created(
      mutate((db) => {
        if (data.id) {
          const existing = db.acadActivities.find((a) => a.id === data.id);
          if (existing) return existing;
        }
        const sem = find(db.acadSemesters, data.semesterId, "Semestre");
        const ts = nowIso();
        const status = data.status ?? "pending";
        const row: AcadActivityRow = {
          id: data.id ?? newId(),
          semesterId: sem.id,
          subjectId: subjectIn(db, data.subjectId, sem.id),
          title: data.title,
          description: orNull(data.description),
          type: data.type ?? "task",
          customType: data.type === "other" ? orNull(data.customType) : null,
          dueDate: data.dueDate ?? null,
          dueTime: data.dueDate ? (data.dueTime ?? null) : null,
          priority: data.priority ?? "medium",
          status,
          progress: status === "done" ? 100 : (data.progress ?? 0),
          references: referencesOf(data.references),
          observations: orNull(data.observations),
          completedAt: status === "done" ? ts : null,
          createdAt: ts,
          updatedAt: ts,
        };
        db.acadActivities.push(row);
        return row;
      })
    );
  }],
  ["PUT", "/academic/activities/:id", ({ params, body }) => {
    const data = parse(activityPatch, body);
    return ok(
      mutate((db) => {
        const a = find(db.acadActivities, params.id, "Actividad");
        const ts = nowIso();
        if (data.subjectId !== undefined) a.subjectId = subjectIn(db, data.subjectId, a.semesterId);
        if (data.title !== undefined) a.title = data.title;
        if (data.description !== undefined) a.description = orNull(data.description);
        if (data.type !== undefined) a.type = data.type;
        if (data.customType !== undefined) a.customType = orNull(data.customType);
        if (a.type !== "other") a.customType = null;
        if (data.dueDate !== undefined) a.dueDate = data.dueDate;
        if (data.dueTime !== undefined) a.dueTime = data.dueTime;
        if (!a.dueDate) a.dueTime = null;
        if (data.priority !== undefined) a.priority = data.priority;
        if (data.progress !== undefined) a.progress = data.progress;
        if (data.status !== undefined && data.status !== a.status) {
          a.status = data.status;
          a.completedAt = data.status === "done" ? ts : null;
        }
        // Completada = 100 %.
        if (a.status === "done") a.progress = 100;
        if (data.references !== undefined) a.references = referencesOf(data.references);
        if (data.observations !== undefined) a.observations = orNull(data.observations);
        a.updatedAt = ts;
        return a;
      })
    );
  }],
  ["DELETE", "/academic/activities/:id", ({ params }) =>
    ok(
      mutate((db) => {
        find(db.acadActivities, params.id, "Actividad");
        purge(db, "acadActivities", (x) => x.id !== params.id);
        return { ok: true };
      })
    ),
  ],
];
