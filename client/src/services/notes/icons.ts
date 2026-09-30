/**
 * Biblioteca de iconos y colores de las notas.
 *
 * Aquí solo viven los NOMBRES (lo que se guarda y se valida); el componente
 * de cada icono se resuelve en `components/notes/NoteIcon.tsx`. Para ampliar
 * la biblioteca basta con `registerNoteIcon` (y añadir su componente): las
 * notas guardadas con un icono desconocido se muestran con el genérico.
 */

export interface NoteIconDef {
  name: string;
  label: string;
}

const ICONS: NoteIconDef[] = [
  { name: "FileText", label: "Documento" },
  { name: "StickyNote", label: "Nota" },
  { name: "Briefcase", label: "Trabajo" },
  { name: "Wallet", label: "Finanzas" },
  { name: "GraduationCap", label: "Estudios" },
  { name: "FolderKanban", label: "Proyectos" },
  { name: "Lightbulb", label: "Ideas" },
  { name: "User", label: "Personal" },
  { name: "Bell", label: "Recordatorios" },
  { name: "ListChecks", label: "Tareas" },
  { name: "Calculator", label: "Cálculos" },
  { name: "Heart", label: "Salud" },
  { name: "Home", label: "Hogar" },
  { name: "Plane", label: "Viajes" },
  { name: "ShoppingCart", label: "Compras" },
  { name: "BookOpen", label: "Lectura" },
  { name: "Code", label: "Código" },
  { name: "Star", label: "Favorito" },
  { name: "Tag", label: "Etiqueta" },
  { name: "CircleEllipsis", label: "Otros" },
];

export const DEFAULT_NOTE_ICON = "FileText";

export function noteIcons(): readonly NoteIconDef[] {
  return ICONS;
}

export function isNoteIcon(name: string): boolean {
  return ICONS.some((i) => i.name === name);
}

/** Añade un icono a la biblioteca (el nombre debe tener componente en `NoteIcon`). */
export function registerNoteIcon(def: NoteIconDef): void {
  if (!/^[A-Za-z][A-Za-z0-9]{1,39}$/.test(def.name)) throw new Error("Nombre de icono no válido");
  if (!isNoteIcon(def.name)) ICONS.push(def);
}

/** Paleta predefinida (colores de identificación; el fondo usa una versión suave). */
export const NOTE_COLORS = [
  "#64748b",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#0ea5e9",
  "#6366f1",
  "#a855f7",
  "#ec4899",
] as const;

/** Luminancia relativa WCAG de un color `#rrggbb`. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Texto legible (casi negro o blanco) sobre un color de fondo. */
export function readableOn(bg: string): "#111827" | "#ffffff" {
  return contrastRatio(bg, "#111827") >= contrastRatio(bg, "#ffffff") ? "#111827" : "#ffffff";
}
