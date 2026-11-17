import { buildBackupFile, backupFileName, markDownloaded, serializeBackup } from "@/services/backup/backup";
import { saveBlob, wasSaved, type SaveResult } from "@/lib/share";

/** Guarda un texto como archivo (descarga en navegador/Windows; «Guardar como» en Android). */
export function downloadText(name: string, text: string, type = "application/json"): Promise<SaveResult> {
  return saveBlob(name, text, type);
}

/**
 * Descarga una copia completa desde la memoria. Sirve también como copia de
 * emergencia cuando el almacenamiento del navegador está fallando.
 * Devuelve el tamaño, o null si el usuario canceló o no se pudo guardar.
 */
export async function downloadBackup(opts: { includeFiles?: boolean; password?: string | null } = {}): Promise<number | null> {
  const file = await buildBackupFile({ includeFiles: opts.includeFiles });
  const text = await serializeBackup(file, opts.password);
  if (!wasSaved(await downloadText(backupFileName(new Date(), !!opts.password), text))) return null;
  markDownloaded(text.length);
  return text.length;
}
