import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { getSaveStatus, onSaveStatus, type SaveStatus } from "@/services/storage";
import { cn } from "@/lib/utils";

export function useSaveStatus(): SaveStatus {
  const [s, setS] = useState(getSaveStatus);
  useEffect(() => onSaveStatus(setS), []);
  return s;
}

/**
 * Estado del guardado, discreto, en la barra superior. «Guardado» solo
 * aparece cuando el almacenamiento confirmó la escritura.
 */
export function SaveIndicator() {
  const s = useSaveStatus();
  const time = s.lastSavedAt ? new Date(s.lastSavedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : null;
  const label =
    s.state === "error"
      ? "Error al guardar"
      : s.state === "saving"
        ? s.retrying
          ? "Reintentando…"
          : "Guardando…"
        : s.state === "saved"
          ? "Guardado"
          : "Datos en este dispositivo";
  const detail =
    s.state === "error"
      ? `${s.error ?? "No se pudo guardar"}. Pulsa para descargar una copia de tus datos.`
      : s.state === "saved" && time
        ? `Guardado en este dispositivo a las ${time}`
        : label;

  return (
    <Link
      to="/configuracion#copias"
      role="status"
      aria-live="polite"
      title={detail}
      aria-label={detail}
      className={cn(
        "h-8 px-2.5 rounded-md flex items-center gap-1.5 text-xs shrink-0",
        s.state === "error" ? "bg-danger/10 text-danger font-medium" : "text-subtle hover:bg-muted"
      )}
    >
      {s.state === "error" ? (
        <AlertTriangle size={14} />
      ) : s.state === "saving" ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <CheckCircle2 size={14} className={s.state === "saved" ? "text-success" : undefined} />
      )}
      <span className={cn(s.state === "error" ? "inline" : "hidden sm:inline")}>{label}</span>
    </Link>
  );
}
