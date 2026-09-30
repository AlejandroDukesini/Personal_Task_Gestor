/**
 * Informes de importación en CSV (se abren en Excel: BOM + fórmulas
 * neutralizadas, como el resto de exportaciones):
 *   - `importReportCsv`: una línea por incidencia, con fila, campo, valor
 *     original, gravedad, solución y estado de resolución.
 *   - `rejectedRowsCsv`: las filas que NO se importaron, con sus valores
 *     originales y el motivo, para corregirlas y volver a importarlas.
 */

import { csvCell } from "../io";
import { FIELD_LABEL } from "./columns";
import type { ImportIssue, IssueResolution, PreviewRow, RowStatus, SmartPreview } from "./types";

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

export const RESOLUTION_LABEL: Record<IssueResolution, string> = {
  auto: "Corregida automáticamente",
  pending: "Pendiente",
  accepted: "Aceptada (se importa)",
  manual: "Corregida a mano",
  excluded: "Fila excluida",
};

export function fieldLabel(field: ImportIssue["field"]): string {
  if (field === "file") return "Archivo";
  if (field === "row") return "Fila";
  return FIELD_LABEL[field] ?? field;
}

export function importReportCsv(preview: SmartPreview): string {
  const header = ["fila", "estado", "se_importa", "campo", "gravedad", "valor_original", "problema", "solucion_sugerida", "resolucion"];
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
        csvCell(i.resolution ? RESOLUTION_LABEL[i.resolution] : ""),
      ].join(",")
    );
  for (const i of preview.fileIssues) push(null, i);
  for (const c of preview.confirmations ?? []) {
    push(null, { row: 0, field: "file", severity: "warning", original: "", message: c.message, suggestion: c.proposal, resolution: "pending" });
  }
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

/** Motivo principal por el que una fila no se importa. */
export function rejectionReason(r: PreviewRow): string {
  const first = r.issues.find((i) => i.severity === "error") ?? r.issues.find((i) => i.severity === "warning");
  if (r.status === "excluded" && !first) return "Excluida por ti";
  return first ? `${fieldLabel(first.field)}: ${first.message}` : STATUS_LABEL[r.status];
}

/** Filas no importadas (salvo las unidas a una transferencia), con sus datos originales. */
export function rejectedRowsCsv(preview: SmartPreview): string {
  const rows = preview.rows.filter((r) => !r.included && r.status !== "merged");
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r.original ?? {})))];
  const lines = [["fila", "estado", "motivo", ...columns].map(csvCell).join(",")];
  for (const r of rows) {
    lines.push([String(r.row), csvCell(STATUS_LABEL[r.status]), csvCell(rejectionReason(r)), ...columns.map((c) => csvCell(r.original?.[c] ?? ""))].join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
