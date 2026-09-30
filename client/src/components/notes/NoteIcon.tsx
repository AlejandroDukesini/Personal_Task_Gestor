import {
  Bell,
  BookOpen,
  Briefcase,
  Calculator,
  CircleEllipsis,
  Code,
  FileText,
  FolderKanban,
  GraduationCap,
  Heart,
  Home,
  Lightbulb,
  ListChecks,
  Plane,
  ShoppingCart,
  Star,
  StickyNote,
  Tag,
  User,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * Componentes de la biblioteca de iconos de notas (los nombres y etiquetas
 * viven en `services/notes/icons.ts`). Lista cerrada a propósito: importar
 * lucide entero para resolver nombres dinámicos pesaría cientos de KB.
 */
export const NOTE_ICON_COMPONENTS: Record<string, LucideIcon> = {
  Bell,
  BookOpen,
  Briefcase,
  Calculator,
  CircleEllipsis,
  Code,
  FileText,
  FolderKanban,
  GraduationCap,
  Heart,
  Home,
  Lightbulb,
  ListChecks,
  Plane,
  ShoppingCart,
  Star,
  StickyNote,
  Tag,
  User,
  Wallet,
};

/** Para ampliar la biblioteca junto con `registerNoteIcon`. */
export function registerNoteIconComponent(name: string, icon: LucideIcon): void {
  NOTE_ICON_COMPONENTS[name] = icon;
}

export function NoteIcon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const Icon = NOTE_ICON_COMPONENTS[name] ?? FileText;
  return <Icon size={size} className={className} aria-hidden />;
}
