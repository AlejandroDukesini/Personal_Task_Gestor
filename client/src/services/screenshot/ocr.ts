// Carga, validación y reconocimiento de texto de capturas. Todo ocurre en el
// dispositivo: la imagen nunca se envía a ningún servidor. Solo se descarga
// (una vez, y la cachea el navegador) el motor de OCR y los datos de idioma.
// La imagen vive en memoria mientras dura el asistente y no se guarda.

import type { Bbox, OcrLine } from "./parse";
import { findChips, meanLuminance, mergeChipLines, normalizeChip } from "./chips";

/** Origen del motor de OCR (solo código y datos de idioma; nunca la imagen). */
export const OCR_CDN = "https://cdn.jsdelivr.net/npm";
export const OCR_VERSION = "7.0.0";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_TYPES = ["image/png", "image/jpeg"];
const MIN_SIDE = 200;
const MAX_SIDE = 8000;

export class ImageValidationError extends Error {}

/** Tipo real por la firma del archivo (no por la extensión que declara el navegador). */
export function sniffImageType(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** Valida tamaño, formato y contenido. Devuelve los bytes para la huella. */
export async function validateImageFile(file: File): Promise<{ bytes: Uint8Array; type: "image/png" | "image/jpeg" }> {
  if (file.size === 0) throw new ImageValidationError("El archivo está vacío.");
  if (file.size > MAX_IMAGE_BYTES) throw new ImageValidationError("La imagen supera los 10 MB. Recórtala o redúcela antes de importarla.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) throw new ImageValidationError("Formato no admitido. Usa una captura PNG, JPG o JPEG.");
  return { bytes, type };
}

export function checkDimensions(width: number, height: number): void {
  if (width < MIN_SIDE || height < MIN_SIDE) throw new ImageValidationError("La imagen es demasiado pequeña para leer los eventos.");
  if (width > MAX_SIDE || height > MAX_SIDE) throw new ImageValidationError("La imagen es demasiado grande (máx. 8000 px por lado).");
}

/** Huella SHA-256 (hex) del contenido: detecta reimportaciones sin guardar la imagen. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Dibuja la imagen (recortada si se indica) en un lienzo. Las capturas
 * pequeñas se amplían (hasta ~2000 px de ancho): Tesseract lee mal el texto
 * de interfaz de 11-13 px, típico de las cabeceras de Google Calendar.
 */
export async function imageToCanvas(bitmap: ImageBitmap, crop?: Crop | null): Promise<HTMLCanvasElement> {
  const c = crop ?? { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
  const scale = c.w < 2000 ? Math.min(3, 2000 / c.w) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(c.w * scale);
  canvas.height = Math.round(c.h * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Borra el contenido del lienzo (la imagen no queda en memoria más de lo necesario). */
export function wipeCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
}

export interface OcrOutput {
  lines: OcrLine[];
  width: number;
  height: number;
}

/** Líneas de un resultado de Tesseract, desplazadas/escaladas a coordenadas de la página. */
function linesOf(data: any, map: (b: Bbox) => Bbox, group?: number): OcrLine[] {
  const out: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        const text = String(line.text ?? "").trim();
        if (!text) continue;
        out.push({
          text,
          confidence: line.confidence,
          bbox: map(line.bbox),
          words: (line.words ?? []).map((w: any) => ({ text: w.text, confidence: w.confidence, bbox: map(w.bbox) })),
          ...(group !== undefined ? { group } : {}),
        });
      }
    }
  }
  return out;
}

/**
 * OCR local con Tesseract (español + inglés), cargado bajo demanda:
 *  1. Una pasada sobre la página completa (cabeceras, eje de horas, texto normal).
 *  2. Una pasada por cada bloque de color de evento, recortado, ampliado y con
 *     el contraste corregido. Recupera el texto blanco sobre fondos oscuros,
 *     que la pasada de página suele perder, y agrupa título y hora.
 */
export async function recognize(canvas: HTMLCanvasElement, onProgress?: (p: number, status: string) => void): Promise<OcrOutput> {
  const { createWorker } = await import("tesseract.js");
  let phase = 0; // 0 = página, 1 = bloques
  const worker = await createWorker(["spa", "eng"], 1, {
    // Rutas fijadas a la versión instalada: coinciden con la CSP (netlify.toml).
    workerPath: `${OCR_CDN}/tesseract.js@${OCR_VERSION}/dist/worker.min.js`,
    corePath: `${OCR_CDN}/tesseract.js-core@${OCR_VERSION}`,
    logger: (m) => {
      if (phase === 0) onProgress?.((m.progress ?? 0) * (m.status?.startsWith("recogniz") ? 0.6 : 0.3), m.status ?? "");
    },
  });
  try {
    const page = await worker.recognize(canvas, {}, { blocks: true });
    const pageLines = linesOf(page.data, (b) => b);

    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const chips = findChips(ctx.getImageData(0, 0, canvas.width, canvas.height));
    phase = 1;
    const chipLines: OcrLine[] = [];
    await worker.setParameters({ tessedit_pageseg_mode: "6" as any });
    for (let i = 0; i < chips.length; i++) {
      onProgress?.(0.6 + (0.4 * i) / Math.max(1, chips.length), "recognizing chips");
      const c = chips[i];
      const pad = 3;
      const bx = { x0: Math.max(0, c.x0 - pad), y0: Math.max(0, c.y0 - pad), x1: Math.min(canvas.width, c.x1 + pad), y1: Math.min(canvas.height, c.y1 + pad) };
      const w = bx.x1 - bx.x0;
      const h = bx.y1 - bx.y0;
      // Letra de al menos ~30 px de alto: los bloques pequeños se amplían.
      const scale = Math.min(4, Math.max(1, 90 / h, 300 / w));
      const crop = document.createElement("canvas");
      crop.width = Math.round(w * scale);
      crop.height = Math.round(h * scale);
      const cx = crop.getContext("2d", { willReadFrequently: true })!;
      cx.imageSmoothingQuality = "high";
      cx.drawImage(canvas, bx.x0, bx.y0, w, h, 0, 0, crop.width, crop.height);
      const img = cx.getImageData(0, 0, crop.width, crop.height);
      normalizeChip(img, meanLuminance(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }) < 150);
      cx.putImageData(img, 0, 0);
      const res = await worker.recognize(crop, {}, { blocks: true });
      const map = (b: Bbox): Bbox => ({ x0: bx.x0 + b.x0 / scale, y0: bx.y0 + b.y0 / scale, x1: bx.x0 + b.x1 / scale, y1: bx.y0 + b.y1 / scale });
      const lines = linesOf(res.data, map, i).filter((l) => l.confidence >= 30);
      crop.width = crop.height = 0;
      chipLines.push(...lines);
    }
    // Lo leído dentro de un bloque sustituye a lo que la página leyó ahí.
    const chipBoxes = chips.filter((_, i) => chipLines.some((l) => l.group === i));
    return { lines: mergeChipLines(pageLines, chipLines, chipBoxes), width: canvas.width, height: canvas.height };
  } finally {
    await worker.terminate();
  }
}

/**
 * Color dominante saturado alrededor de una caja (el fondo o la franja del
 * evento en Google Calendar). null si no hay un color claro.
 */
export function sampleColor(canvas: HTMLCanvasElement, bbox: Bbox): string | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const x0 = Math.max(0, Math.floor(bbox.x0) - 8);
  const y0 = Math.max(0, Math.floor(bbox.y0) - 4);
  const w = Math.min(canvas.width - x0, Math.ceil(bbox.x1 - bbox.x0) + 16);
  const hgt = Math.min(canvas.height - y0, Math.ceil(bbox.y1 - bbox.y0) + 8);
  if (w <= 0 || hgt <= 0) return null;
  const data = ctx.getImageData(x0, y0, w, hgt).data;
  const buckets = new Map<string, number>();
  for (let i = 0; i < data.length; i += 16) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 40 || max - min < 50) continue; // grises, blanco, negro, texto
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const best = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 6) return null;
  const [r, g, b] = best[0].split(",").map((v) => Number(v) * 16 + 8);
  return `#${[r, g, b].map((v) => Math.min(255, v).toString(16).padStart(2, "0")).join("")}`;
}
