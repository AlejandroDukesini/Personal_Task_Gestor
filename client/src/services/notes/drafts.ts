/**
 * Recuperación de cambios ante cierres inesperados.
 *
 * Mientras se edita una nota, los cambios aún no guardados se copian en
 * `localStorage` (escritura síncrona: sobrevive a un cierre brusco de la
 * pestaña). Al guardar con éxito se borra. Si al abrir la nota hay un
 * borrador más reciente que la nota guardada, se ofrece recuperarlo.
 */

import { z } from "zod";

const PREFIX = "gestion-tareas:note-draft:";

const draftSchema = z.object({
  savedAt: z.string(),
  baseUpdatedAt: z.string(),
  patch: z.record(z.unknown()),
});

export type NoteDraft = z.infer<typeof draftSchema>;

export function writeDraft(noteId: string, baseUpdatedAt: string, patch: Record<string, unknown>): void {
  try {
    localStorage.setItem(PREFIX + noteId, JSON.stringify({ savedAt: new Date().toISOString(), baseUpdatedAt, patch } satisfies NoteDraft));
  } catch {
    // Sin espacio o modo privado: el autoguardado normal sigue funcionando.
  }
}

export function readDraft(noteId: string): NoteDraft | null {
  try {
    const raw = localStorage.getItem(PREFIX + noteId);
    if (!raw) return null;
    const r = draftSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function clearDraft(noteId: string): void {
  try {
    localStorage.removeItem(PREFIX + noteId);
  } catch {
    /* sin almacenamiento */
  }
}

/**
 * ¿El borrador contiene cambios que no llegaron a guardarse? Lo está si se
 * escribió sobre la versión guardada ACTUAL (tras cada guardado correcto se
 * borra). No se comparan horas: la marca de la nota usa el reloj monotónico
 * de la app y la del borrador el del sistema, que pueden no coincidir.
 */
export function draftIsNewer(draft: NoteDraft | null, noteUpdatedAt: string): boolean {
  return !!draft && Object.keys(draft.patch).length > 0 && draft.baseUpdatedAt === noteUpdatedAt;
}
