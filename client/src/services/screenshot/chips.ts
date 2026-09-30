// Detección de los bloques de color de los eventos de Google Calendar.
//
// El OCR de página completa pierde con frecuencia el texto blanco sobre
// fondos de color oscuros (morado, azul marino…). Localizando cada bloque y
// leyéndolo por separado —recortado, ampliado y con el contraste corregido—
// se recupera ese texto y, de paso, se sabe qué título y qué hora van juntos.
// Funciones puras sobre píxeles RGBA: se prueban sin navegador.

import type { Bbox } from "./parse";

export interface Pixels {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

const CELL = 3;

/** ¿El píxel pertenece a un fondo de evento (color saturado, ni blanco ni gris ni negro)? */
function saturated(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 50) return false;
  return (max - min) / max > 0.35 && max - min > 45;
}

/**
 * Rectángulos de color de al menos `minW`×`minH` píxeles. Trabaja sobre una
 * rejilla de celdas de 3 px (rápido y tolera el texto dentro del bloque).
 */
export function findChips(px: Pixels, opts: { minW?: number; minH?: number; max?: number } = {}): Bbox[] {
  const minW = opts.minW ?? 28;
  const minH = opts.minH ?? 12;
  const cols = Math.floor(px.width / CELL);
  const rows = Math.floor(px.height / CELL);
  const grid = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let hits = 0;
      for (let dy = 0; dy < CELL; dy++) {
        for (let dx = 0; dx < CELL; dx++) {
          const i = ((cy * CELL + dy) * px.width + cx * CELL + dx) * 4;
          if (saturated(px.data[i], px.data[i + 1], px.data[i + 2])) hits++;
        }
      }
      grid[cy * cols + cx] = hits >= 3 ? 1 : 0;
    }
  }
  // Cierre: una celda vacía rodeada de color (letras blancas) cuenta como bloque.
  const closed = grid.slice();
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const k = y * cols + x;
      if (grid[k]) continue;
      const h = grid[k - 1] && grid[k + 1];
      const v = grid[k - cols] && grid[k + cols];
      if (h || v) closed[k] = 1;
    }
  }

  const seen = new Uint8Array(cols * rows);
  const out: Bbox[] = [];
  const stack: number[] = [];
  for (let start = 0; start < closed.length; start++) {
    if (!closed[start] || seen[start]) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, count = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % cols;
      const y = (k - x) / cols;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const n of [k - 1, k + 1, k - cols, k + cols]) {
        if (n < 0 || n >= closed.length || seen[n] || !closed[n]) continue;
        if ((n === k - 1 && x === 0) || (n === k + 1 && x === cols - 1)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    const w = (x1 - x0 + 1) * CELL;
    const h = (y1 - y0 + 1) * CELL;
    // Bloque "lleno" (no una línea fina ni un icono disperso).
    if (w >= minW && h >= minH && count >= 0.5 * (x1 - x0 + 1) * (y1 - y0 + 1)) {
      out.push({ x0: x0 * CELL, y0: y0 * CELL, x1: (x1 + 1) * CELL, y1: (y1 + 1) * CELL });
    }
  }
  return out.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).slice(0, opts.max ?? 80);
}

/** Luminancia media del bloque: decide si el texto es claro (fondo oscuro) u oscuro. */
export function meanLuminance(px: Pixels, b: Bbox): number {
  let sum = 0;
  let n = 0;
  for (let y = Math.max(0, b.y0); y < Math.min(px.height, b.y1); y += 2) {
    for (let x = Math.max(0, b.x0); x < Math.min(px.width, b.x1); x += 2) {
      const i = (y * px.width + x) * 4;
      sum += 0.299 * px.data[i] + 0.587 * px.data[i + 1] + 0.114 * px.data[i + 2];
      n++;
    }
  }
  return n ? sum / n : 255;
}

/**
 * Convierte el bloque a escala de grises con texto oscuro sobre fondo claro,
 * que es lo que mejor lee Tesseract. Con fondo oscuro se invierte el canal
 * mínimo: el fondo de color queda claro y las letras blancas, negras.
 */
export function normalizeChip(px: Pixels, darkBackground: boolean): void {
  for (let i = 0; i < px.data.length; i += 4) {
    const r = px.data[i];
    const g = px.data[i + 1];
    const b = px.data[i + 2];
    const v = darkBackground ? 255 - Math.min(r, g, b) : 0.299 * r + 0.587 * g + 0.114 * b;
    px.data[i] = px.data[i + 1] = px.data[i + 2] = v;
  }
}

const centerIn = (b: Bbox, box: Bbox) => {
  const x = (b.x0 + b.x1) / 2;
  const y = (b.y0 + b.y1) / 2;
  return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
};

/**
 * Une la lectura de la página con la de los bloques. Dentro de un bloque
 * manda su lectura; de las líneas de la página se conservan las PALABRAS que
 * caen fuera de los bloques (p. ej. la fecha "JUE" que el OCR pegó al título).
 */
export function mergeChipLines<L extends { text: string; bbox: Bbox; words?: { text: string; bbox: Bbox }[] }>(
  pageLines: L[],
  chipLines: L[],
  chipBoxes: Bbox[]
): L[] {
  const kept: L[] = [];
  for (const l of pageLines) {
    if (!chipBoxes.some((c) => centerIn(l.bbox, c) || (l.words ?? []).some((w) => centerIn(w.bbox, c)))) {
      kept.push(l);
      continue;
    }
    const rest = (l.words ?? []).filter((w) => !chipBoxes.some((c) => centerIn(w.bbox, c)));
    if (!rest.length) continue;
    kept.push({
      ...l,
      text: rest.map((w) => w.text).join(" "),
      words: rest,
      bbox: {
        x0: Math.min(...rest.map((w) => w.bbox.x0)),
        y0: Math.min(...rest.map((w) => w.bbox.y0)),
        x1: Math.max(...rest.map((w) => w.bbox.x1)),
        y1: Math.max(...rest.map((w) => w.bbox.y1)),
      },
    });
  }
  return [...kept, ...chipLines];
}
