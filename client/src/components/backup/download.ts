import { buildBackupFile, backupFileName, markDownloaded, serializeBackup } from "@/services/backup/backup";

/** Descarga un texto como archivo (el navegador lo guarda en el equipo). */
export function downloadText(name: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Descarga una copia completa desde la memoria. Sirve también como copia de
 * emergencia cuando el almacenamiento del navegador está fallando.
 */
export async function downloadBackup(opts: { includeFiles?: boolean; password?: string | null } = {}): Promise<number> {
  const file = await buildBackupFile({ includeFiles: opts.includeFiles });
  const text = await serializeBackup(file, opts.password);
  downloadText(backupFileName(new Date(), !!opts.password), text);
  markDownloaded(text.length);
  return text.length;
}
