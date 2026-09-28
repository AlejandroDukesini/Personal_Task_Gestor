import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { applyUpdate, onUpdateReady } from "@/lib/pwa";

/**
 * Aviso de versión nueva. Actualizar el código de la app es independiente de
 * sincronizar datos: aquí solo cambia el programa; tus datos siguen en el
 * dispositivo y, si su formato cambia, se migran con copia previa.
 */
export function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => onUpdateReady(setReady), []);
  if (!ready) return null;
  return (
    <div className="gt-safe-x [--gt-pad-x:1rem] sm:[--gt-pad-x:1.5rem] lg:[--gt-pad-x:2rem] pt-3" role="status">
      <div className="gt-surface flex items-center gap-3 p-3 text-sm border-primary">
        <Sparkles size={18} className="text-primary shrink-0" aria-hidden />
        <span className="flex-1">Hay una versión nueva de la app. Tus datos no cambian.</span>
        <button
          className="gt-control h-10 px-4 bg-primary text-primary-fg font-medium shrink-0"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await applyUpdate();
          }}
        >
          {busy ? "Actualizando…" : "Actualizar"}
        </button>
      </div>
    </div>
  );
}
