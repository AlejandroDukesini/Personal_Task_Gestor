import { useParams, useSearchParams } from "react-router-dom";
import { NoteDetail } from "@/components/notes/NoteDetail";
import { FINANCE_NOTES, NotesBoard, useNoteCategories } from "@/pages/Notes";

/**
 * Notas financieras: el bloc de notas de la app en su espacio «finance».
 * Mismo editor, adjuntos, categorías, archivo y papelera que las notas
 * generales, pero con sus propias categorías (ahorro, deudas…) y sin mezclarse
 * con ellas. Son solo anotaciones: no crean ni tocan movimientos.
 */
export function FinanceNotesView() {
  const { categories, reload } = useNoteCategories("finance");
  return <NotesBoard space="finance" paths={FINANCE_NOTES} categories={categories} reloadCategories={reload} embedded />;
}

/** Página de una nota financiera (`/finanzas/notas/:id`). */
export function FinanceNotePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { categories, reload } = useNoteCategories("finance");
  if (!id) return null;
  return <NoteDetail key={id} id={id} categories={categories} startEditing={params.get("edit") === "1"} onChanged={reload} paths={FINANCE_NOTES} />;
}
