import { Check, CloudOff, Loader2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

export type SaveState = "saved" | "pending" | "saving" | "error";

/** Estado del autoguardado de un elemento (nota, proyecto…), con reintento. */
export function SaveStatus({ status, onRetry }: { status: SaveState; onRetry: () => void }) {
  const map = {
    saved: { icon: <Check size={14} />, text: "Guardado", cls: "text-success" },
    pending: { icon: <Pencil size={14} />, text: "Cambios sin guardar…", cls: "text-subtle" },
    saving: { icon: <Loader2 size={14} className="animate-spin" />, text: "Guardando…", cls: "text-subtle" },
    error: { icon: <CloudOff size={14} />, text: "No guardado", cls: "text-danger" },
  }[status];
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1 text-xs", map.cls)}>
      {map.icon} {map.text}
      {status === "error" && (
        <button className="underline ml-1" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </span>
  );
}
