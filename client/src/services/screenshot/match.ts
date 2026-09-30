// Asocia eventos reconocidos con hábitos existentes: nombre (con sinónimos y
// tolerancia a errores de OCR) y, como apoyo, coincidencia de horario.

import { normalizeText } from "@/services/habits/hash";
import { occursOn } from "@/services/habits/schedule";
import type { HabitRow, HabitScheduleRow } from "@/services/localDb";

/** Grupos de palabras equivalentes (es/en). */
const SYNONYMS: string[][] = [
  ["leer", "lectura", "libro", "libros", "reading", "read", "book"],
  ["ejercicio", "gimnasio", "gym", "entrenar", "entrenamiento", "workout", "exercise", "deporte", "pesas", "fitness"],
  ["correr", "running", "run", "trotar", "footing"],
  ["agua", "beber", "hidratacion", "hidratarse", "water", "drink", "vasos", "vaso"],
  ["meditar", "meditacion", "mindfulness", "meditate", "meditation", "respiracion"],
  ["estudiar", "estudio", "study", "repasar", "clase", "curso"],
  ["dormir", "sueno", "sleep", "siesta"],
  ["caminar", "caminata", "paseo", "pasear", "walk", "walking"],
  ["yoga", "estiramientos", "stretching", "estirar"],
  ["escribir", "diario", "journal", "journaling", "escritura"],
  ["cama", "tender", "hacer la cama", "bed"],
  ["idioma", "ingles", "english", "duolingo", "frances", "idiomas"],
  ["cocinar", "cocina", "cook", "cooking"],
  ["limpiar", "limpieza", "clean", "cleaning", "ordenar"],
  ["vitaminas", "pastilla", "medicina", "medicamento", "pills"],
];

const STOP = new Set(["de", "del", "la", "el", "los", "las", "un", "una", "a", "al", "y", "en", "con", "por", "para", "min", "minutos", "h", "the", "of", "to", "my", "mi"]);

const canonical = new Map<string, string>();
SYNONYMS.forEach((group, i) => group.forEach((w) => canonical.set(normalizeText(w), `#${i}`)));

function canonOf(word: string): string {
  const exact = canonical.get(word);
  if (exact) return exact;
  // Prefijo común (lectura/leer no, pero entrenar/entrenamiento sí).
  for (const [w, c] of canonical) if (w.length >= 5 && word.length >= 5 && (w.startsWith(word.slice(0, 5)) || word.startsWith(w.slice(0, 5)))) return c;
  return word.length > 5 ? word.slice(0, 5) : word;
}

export function tokens(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    // Cantidades ("2l", "20", "30min") no identifican el hábito.
    .filter((w) => w && !STOP.has(w) && !/^\d+[a-z]{0,3}$/.test(w));
}

function bigrams(s: string): string[] {
  const t = normalizeText(s).replace(/ /g, "");
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

function dice<T>(a: T[], b: T[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<T, number>();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  let inter = 0;
  for (const x of b) {
    const c = counts.get(x) ?? 0;
    if (c > 0) {
      inter++;
      counts.set(x, c - 1);
    }
  }
  return (2 * inter) / (a.length + b.length);
}

/** Similitud 0-1 entre el título de un evento y el nombre de un hábito. */
export function nameSimilarity(eventTitle: string, habitName: string): number {
  const a = normalizeText(eventTitle);
  const b = normalizeText(habitName);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if ((a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b))) return 0.9;
  const ta = [...new Set(tokens(a).map(canonOf))];
  const tb = [...new Set(tokens(b).map(canonOf))];
  // Mismo concepto con otras palabras ("Leer" ~ "Lectura"): fiable, pero por
  // debajo de una coincidencia literal, para que esta gane si existen ambas.
  const covered = ta.length > 0 && ta.every((t) => tb.includes(t)) ? 0.85 : 0;
  // …o todo el hábito está en el evento ("Tomar agua" ~ "Beber agua").
  const reverse = tb.length > 0 && tb.every((t) => ta.includes(t)) ? 0.8 : 0;
  return Math.max(covered, reverse, 0.85 * dice(ta, tb), 0.85 * dice(bigrams(a), bigrams(b)));
}

export interface HabitMatch {
  habitId: string;
  name: string;
  score: number;
}

export type MatchDecision =
  | { kind: "match"; habitId: string; score: number; candidates: HabitMatch[] }
  | { kind: "ambiguous"; candidates: HabitMatch[] }
  | { kind: "none"; candidates: HabitMatch[] };

export const AUTO_THRESHOLD = 0.75;
export const SUGGEST_THRESHOLD = 0.45;

export function matchHabits(
  event: { title: string; date: string | null; startTime: string | null },
  habits: (HabitRow & { schedules?: HabitScheduleRow[] })[]
): MatchDecision {
  const scored: (HabitMatch & { rank: number })[] = habits
    .filter((h) => !h.archived)
    .map((h) => {
      const score = nameSimilarity(event.title, h.name);
      let rank = score;
      // Apoyo: el hábito está programado ese día a esa hora (±30 min).
      if (score >= 0.3 && event.date && event.startTime && h.schedules?.length) {
        const [eh, em] = event.startTime.split(":").map(Number);
        const hit = h.schedules.some((s) => {
          if (!occursOn(s, event.date!)) return false;
          const [sh, sm] = s.startTime.split(":").map(Number);
          return Math.abs(sh * 60 + sm - (eh * 60 + em)) <= 30;
        });
        if (hit) rank += 0.15;
      }
      return { habitId: h.id, name: h.name, score: Math.round(Math.min(1, rank) * 100) / 100, rank };
    })
    .filter((m) => m.rank >= 0.3)
    .sort((a, b) => b.rank - a.rank);

  const out = (list: typeof scored): HabitMatch[] => list.slice(0, 5).map(({ rank: _r, ...m }) => m);
  const [best, second] = scored;
  if (best && best.rank >= AUTO_THRESHOLD && (!second || best.rank - second.rank >= 0.15)) {
    return { kind: "match", habitId: best.habitId, score: best.score, candidates: out(scored) };
  }
  if (best && best.rank >= SUGGEST_THRESHOLD) return { kind: "ambiguous", candidates: out(scored) };
  return { kind: "none", candidates: out(scored) };
}
