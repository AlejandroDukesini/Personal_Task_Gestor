/**
 * Informe de importación en CSV: una línea por incidencia, con la fila, el
 * campo, el valor original y qué hacer. Se abre en Excel (BOM + fórmulas
 * neutralizadas, como el resto de exportaciones).
 */

import { csvCell } from "../io";
import { FIELD_LABEL } from "./columns";
import type { ImportIssue, PreviewRow, RowStatus, SmartPreview } from "./types";

export const STATUS_LABEL: Record<RowStatus, string> = {
  valid: "Válida",
  fixed: "Autocorregida",
  warning: "Con advertencias",
  error: "Error",
  duplicate: "Duplicada",
  excluded: "Excluida",
  merged: "Unida a otra fila",
};

export const SEVERITY_LABEL: Record<ImportIssue["severity"], string> = {
  error: "Error crítico",
  warning: "Advertencia",
  fixed: "Corregido automáticamente",
};

export function fieldLabel(field: ImportIssue["field"]): string {
  if (field === "file") return "Archivo";
  if (field === "row") return "Fila";
  return FIELD_LABEL[field] ?? field;
}

export function importReportCsv(preview: SmartPreview): string {
  const header = ["fila", "estado", "se_importa", "campo", "gravedad", "valor_original", "problema", "solucion_sugerida"];
  const lines = [header.join(",")];
  const push = (row: PreviewRow | null, i: ImportIssue) =>
    lines.push(
      [
        i.row ? String(i.row) : "archivo",
        csvCell(row ? STATUS_LABEL[row.status] : ""),
        row ? (row.included ? "sí" : "no") : "",
        csvCell(fieldLabel(i.field)),
        csvCell(SEVERITY_LABEL[i.severity]),
        csvCell(i.original),
        csvCell(i.message),
        csvCell(i.suggestion),
      ].join(",")
    );
  for (const i of preview.fileIssues) push(null, i);
  for (const r of preview.rows) for (const i of r.issues) push(r, i);
  const t = preview.totals;
  lines.push("");
  lines.push(
    csvCell(
      `Resumen: ${t.total} filas · ${t.toImport} se importan · ${t.valid} válidas · ${t.fixed} autocorregidas · ${t.warnings} con advertencias · ${t.errors} con errores · ${t.duplicates} duplicadas · ${t.excluded} excluidas`
    )
  );
  return `﻿${lines.join("\r\n")}\r\n`;
}
