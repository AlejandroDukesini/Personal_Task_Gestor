/**
 * Guardar o compartir un archivo generado por la app.
 *
 * En iOS, dentro de una PWA instalada, una descarga con `<a download>` abre
 * una vista previa de la que es difícil volver. La hoja de compartir (Web
 * Share con archivos, iOS 15+) permite «Guardar en Archivos», AirDrop, correo…
 * En escritorio se descarga como siempre.
 */
export async function saveFile(name: string, content: string, mime = "application/json"): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([content], name, { type: mime });
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

/** Lee un archivo elegido por el usuario, con límite de tamaño. */
export async function readPickedFile(file: File, maxBytes = 50 * 1024 * 1024): Promise<string> {
  if (file.size > maxBytes) throw new Error(`El archivo supera ${Math.round(maxBytes / 1024 / 1024)} MB`);
  return file.text();
}

export function stampForFile(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
