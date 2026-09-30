import { Check } from "lucide-react";
import { NOTE_COLORS, noteIcons, readableOn } from "@/services/notes/icons";
import { cn } from "@/lib/utils";
import { NoteIcon } from "./NoteIcon";

/** Paleta predefinida + color personalizado + opción «predeterminado». */
export function ColorPicker({ value, onChange, allowDefault = false, label = "Color" }: { value: string | null; onChange: (v: string | null) => void; allowDefault?: boolean; label?: string }) {
  return (
    <fieldset>
      <legend className="text-xs font-medium text-subtle uppercase tracking-wide mb-1.5">{label}</legend>
      <div className="flex flex-wrap items-center gap-1.5">
        {allowDefault && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-pressed={value === null}
            className={cn("h-8 px-2 rounded-md border border-border text-xs", value === null && "ring-2 ring-primary")}
          >
            Predeterminado
          </button>
        )}
        {NOTE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={`Color ${c}`}
            aria-pressed={value === c}
            className={cn("h-8 w-8 rounded-md flex items-center justify-center", value === c && "ring-2 ring-offset-2 ring-primary")}
            style={{ background: c, color: readableOn(c) }}
          >
            {value === c && <Check size={14} aria-hidden />}
          </button>
        ))}
        <label className="h-8 flex items-center gap-1 text-xs text-subtle">
          <input type="color" aria-label="Color personalizado" value={value ?? "#6366f1"} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 p-0 border border-border rounded-md" />
          Otro
        </label>
      </div>
    </fieldset>
  );
}

export function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <fieldset>
      <legend className="text-xs font-medium text-subtle uppercase tracking-wide mb-1.5">Símbolo</legend>
      <div className="grid grid-cols-6 sm:grid-cols-10 gap-1">
        {noteIcons().map((i) => (
          <button
            key={i.name}
            type="button"
            onClick={() => onChange(i.name)}
            title={i.label}
            aria-label={i.label}
            aria-pressed={value === i.name}
            className={cn("h-9 rounded-md flex items-center justify-center text-subtle hover:bg-muted hover:text-text", value === i.name && "bg-primary/15 text-primary")}
          >
            <NoteIcon name={i.name} size={18} />
          </button>
        ))}
      </div>
    </fieldset>
  );
}
