/**
 * Perfiles de asignación de columnas guardados por el usuario.
 *
 * Se guardan en `localStorage` de este dispositivo y NO en la base de datos:
 * son una preferencia de interfaz (como el tema), no datos financieros, y así
 * no hace falta migrar el esquema ni sincronizarlos. Lo leído se valida: el
 * almacenamiento del navegador también es entrada no confiable.
 */

import { z } from "zod";
import { IMPORT_FIELDS, headerKey, headerOverlap, headerSignature, mappingFromColumns, type ColumnMapping } from "./columns";
import { DUPLICATE_FIELDS, type ImportOptions } from "./types";

/** Cabecera «virtual» para guardar las preferencias de las copias de Cashew (no tienen cabeceras). */
export const CASHEW_PROFILE_HEADERS = ["__cashew_backup__"];

const KEY = "gestion-tareas:import-profiles";
const MAX_PROFILES = 30;

const profileSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(60),
  signature: z.string().max(5000),
  headers: z.array(z.string().max(200)).max(300),
  columns: z.record(z.enum(IMPORT_FIELDS).nullable()),
  options: z
    .object({
      dateOrder: z.enum(["auto", "dmy", "mdy", "ymd"]).optional(),
      decimal: z.enum(["auto", ",", "."]).optional(),
      zone: z.enum(["local", "utc"]).optional(),
      allowRounding: z.boolean().optional(),
      defaultAccountId: z.string().max(128).nullable().optional(),
      defaultCurrency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
      createAccounts: z.boolean().optional(),
      createCategories: z.boolean().optional(),
      accountMap: z.record(z.string().regex(/^(create|none|exclude|id:[\w:.-]{1,128})$/)).optional(),
      categoryMap: z.record(z.string().regex(/^(create|none|exclude|id:[\w:.-]{1,128})$/)).optional(),
      duplicateFields: z.array(z.enum(DUPLICATE_FIELDS)).optional(),
      confirmed: z.array(z.enum(["dateOrder", "decimal", "currency", "mapping"])).optional(),
    })
    .default({}),
  updatedAt: z.string(),
});

export type MappingProfile = z.infer<typeof profileSchema>;

export function loadProfiles(): MappingProfile[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    const parsed = z.array(z.unknown()).safeParse(raw);
    if (!parsed.success) return [];
    return parsed.data.flatMap((p) => {
      const r = profileSchema.safeParse(p);
      return r.success ? [r.data] : [];
    });
  } catch {
    return [];
  }
}

function store(list: MappingProfile[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_PROFILES)));
  } catch {
    // Sin almacenamiento (modo privado): el perfil vive solo esta sesión.
  }
}

/** Guarda (o sustituye, si ya hay uno con las mismas cabeceras) un perfil. */
export function saveProfile(name: string, headers: string[], mapping: ColumnMapping, options: Partial<ImportOptions>): MappingProfile {
  const signature = headerSignature(headers);
  const columns: MappingProfile["columns"] = {};
  headers.forEach((h, i) => (columns[headerKey(h)] = mapping[i] ?? null));
  const list = loadProfiles();
  const prev = list.find((p) => p.signature === signature);
  const profile: MappingProfile = {
    id: prev?.id ?? `p-${Date.now().toString(36)}`,
    name: name.trim().slice(0, 60) || "Perfil sin nombre",
    signature,
    headers: headers.map(headerKey),
    columns,
    options: {
      dateOrder: options.dateOrder,
      decimal: options.decimal,
      zone: options.zone,
      allowRounding: options.allowRounding,
      defaultAccountId: options.defaultAccountId ?? null,
      defaultCurrency: options.defaultCurrency ?? null,
      createAccounts: options.createAccounts,
      createCategories: options.createCategories,
      accountMap: options.accountMap,
      categoryMap: options.categoryMap,
      duplicateFields: options.duplicateFields,
      confirmed: options.confirmed,
    },
    updatedAt: new Date().toISOString(),
  };
  store([profile, ...list.filter((p) => p.id !== profile.id)]);
  return profile;
}

export function deleteProfile(id: string): void {
  store(loadProfiles().filter((p) => p.id !== id));
}

/** Perfil para estas cabeceras: firma idéntica o, si no, el que coincide en ≥ 80 %. */
export function findProfile(headers: string[], list = loadProfiles()): MappingProfile | null {
  const signature = headerSignature(headers);
  const exact = list.find((p) => p.signature === signature);
  if (exact) return exact;
  let best: MappingProfile | null = null;
  let score = 0;
  for (const p of list) {
    // Coincidencia en ambos sentidos: un fichero con muchas más columnas no es «el mismo».
    const s = Math.min(headerOverlap(p.headers, headers), headerOverlap(headers.map(headerKey), p.headers));
    if (s > score) [best, score] = [p, s];
  }
  return score >= 0.8 ? best : null;
}

export function profileMapping(profile: MappingProfile, headers: string[]): ColumnMapping {
  return mappingFromColumns(headers, profile.columns);
}
