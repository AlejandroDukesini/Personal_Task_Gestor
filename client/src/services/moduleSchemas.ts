/**
 * Esquemas estrictos de las colecciones de `MODULE_COLLECTIONS` (módulos
 * añadidos desde la v8). La importación de copias, la restauración y la
 * sincronización validan con este mapa: un módulo nuevo solo se registra aquí.
 */

import type { z } from "zod";
import type { MODULE_COLLECTIONS } from "./localDb";
import { ACADEMIC_ROW_SCHEMAS } from "./academic/schemas";

export const MODULE_ROW_SCHEMAS: Record<(typeof MODULE_COLLECTIONS)[number], z.ZodTypeAny> = {
  ...ACADEMIC_ROW_SCHEMAS,
};
