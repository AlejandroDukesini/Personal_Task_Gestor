// Fusión a tres bandas de la base completa, para cuando dos pestañas (o la
// pestaña y la app instalada) escriben a la vez.
//
// Antes, cada pestaña guardaba su copia ENTERA: la última en escribir borraba
// en silencio lo que otra había guardado entre medias (una pestaña antigua
// que marcaba un recordatorio como avisado podía deshacer días de trabajo).
// Ahora, si al escribir el almacenamiento ya no es el que esta pestaña leyó,
// se fusiona fila a fila: se toma lo que cambió cada lado respecto a la base
// común y, solo si ambos cambiaron la MISMA fila, gana la edición más reciente.

import type { Db } from "@/services/localDb";
import { entriesOf, norm, DELETED, type Entry } from "@/services/manualsync/keyspace";
import { writeEntry } from "@/services/manualsync/engine";

export interface MergeStats {
  fromOurs: number;
  fromTheirs: number;
  conflicts: number;
}

function stampOf(e: Entry | undefined): string {
  if (!e) return "";
  if (!e.row) return e.deletedAt ?? "";
  return String(e.row.updatedAt ?? e.row.createdAt ?? "");
}

/**
 * @param base   lo último que esta pestaña leyó o escribió en el almacenamiento
 * @param ours   el estado actual en memoria de esta pestaña
 * @param theirs lo que hay ahora en el almacenamiento (escrito por otra pestaña)
 */
export function mergeDbs(base: Db | null, ours: Db, theirs: Db | null, stats?: MergeStats): Db {
  if (!theirs) return ours;
  const result = structuredClone(theirs);
  const eb = base ? entriesOf(base) : new Map<string, Entry>();
  const eo = entriesOf(ours);
  const et = entriesOf(theirs);
  const keys = new Set([...eo.keys(), ...eb.keys()]);

  for (const key of keys) {
    if (key === "settings:shared") continue; // los ajustes se fusionan campo a campo
    const b = eb.get(key);
    const o = eo.get(key);
    const t = et.get(key);
    const hb = norm(b?.hash);
    const ho = norm(o?.hash);
    const ht = norm(t?.hash);
    if (ho === hb) continue; // esta pestaña no lo tocó: vale lo del almacenamiento
    let takeOurs = ht === hb || ht === ho;
    if (!takeOurs) {
      // Ambas lo cambiaron distinto: gana la edición más reciente.
      stats && stats.conflicts++;
      takeOurs = stampOf(o) >= stampOf(t);
    }
    if (!takeOurs) {
      stats && stats.fromTheirs++;
      continue;
    }
    stats && stats.fromOurs++;
    if (ho === DELETED) writeEntry(result, key, null, o?.deletedAt);
    else writeEntry(result, key, o!.row as Record<string, unknown>);
  }

  // Ajustes: todos los campos (también los propios del dispositivo), uno a uno.
  const sb = (base?.settings ?? {}) as unknown as Record<string, unknown>;
  const so = ours.settings as unknown as Record<string, unknown>;
  const st = result.settings as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(so), ...Object.keys(sb)])) {
    if (JSON.stringify(so[k]) !== JSON.stringify(sb[k])) st[k] = so[k];
  }

  result.version = Math.max(ours.version ?? 0, theirs.version ?? 0);
  return result;
}
