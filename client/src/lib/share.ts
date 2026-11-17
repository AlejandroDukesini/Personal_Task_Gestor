import toast from "react-hot-toast";
import { isAndroid } from "@/lib/desktop";

/** "error": ya se avisó al usuario con un toast; el archivo NO se guardó. */
export type SaveResult = "shared" | "downloaded" | "saved" | "cancelled" | "error";

/** ¿El archivo llegó a guardarse/compartirse? (false si se canceló o falló). */
export const wasSaved = (r: SaveResult): boolean => r !== "cancelled" && r !== "error";

/**
 * App de Android (APK): la WebView ignora las descargas `<a download>`, así
 * que se abre el selector «Guardar como» del sistema (plugin `dialog`) y se
 * escribe el archivo en la ubicación elegida (plugin `fs`). La app no pide
 * permisos de almacenamiento: solo escribe donde el usuario elige.
 */
async function saveOnAndroid(file: File): Promise<SaveResult> {
  try {
    const [{ save }, { writeFile }] = await Promise.all([import("@tauri-apps/plugin-dialog"), import("@tauri-apps/plugin-fs")]);
    const path = await save({ defaultPath: file.name });
    if (!path) return "cancelled";
    await writeFile(path, new Uint8Array(await file.arrayBuffer()));
    toast.success(`Guardado: ${file.name}`);
    return "saved";
  } catch (e) {
    toast.error(`No se pudo guardar el archivo: ${e instanceof Error ? e.message : String(e)}`);
    return "error";
  }
}

/**
 * Guarda un archivo binario o de texto en el dispositivo. Punto único para
 * todas las descargas de la app (copias, exportaciones, adjuntos).
 */
export async function saveBlob(name: string, data: Blob | string, mime = "application/octet-stream"): Promise<SaveResult> {
  const file = new File([data], name, { type: data instanceof Blob && data.type ? data.type : mime });
  if (isAndroid) return saveOnAndroid(file);
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "downloaded";
}

/**
 * Guardar o compartir un archivo generado por la app.
 *
 * En iOS, dentro de una PWA instalada, una descarga con `<a download>` abre
 * una vista previa de la que es difícil volver. La hoja de compartir (Web
 * Share con archivos, iOS 15+) permite «Guardar en Archivos», AirDrop, correo…
 * En escritorio se descarga como siempre; en Android, ver `saveOnAndroid`.
 */
export async function saveFile(name: string, content: string, mime = "application/json"): Promise<SaveResult> {
  const file = new File([content], name, { type: mime });
  if (isAndroid) return saveOnAndroid(file);
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  if (touch && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return "shared";
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return "cancelled";
      // Otro error: se cae a la descarga normal.
    }
  }
  return saveBlob(name, file);
}

/** Lee un archivo elegido por el usuario, con límite de tamaño. */
export async function readPickedFile(file: File, maxBytes = 50 * 1024 * 1024): Promise<string> {
  if (file.size > maxBytes) throw new Error(`El archivo supera ${Math.round(maxBytes / 1024 / 1024)} MB`);
  return file.text();
}

export function stampForFile(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
