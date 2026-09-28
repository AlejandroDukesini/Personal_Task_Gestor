import { useEffect, useId, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}

const mobileQuery = "(max-width: 639px)";

/**
 * Diálogo modal. En el móvil es una hoja inferior (como las de iOS): ocupa el
 * ancho, sube desde abajo, respeta la zona de la cámara y el indicador de
 * inicio, y su cabecera queda fija al desplazar el contenido. En escritorio,
 * ventana centrada.
 */
export function Dialog({ open, onClose, title, description, children, size = "md" }: Props) {
  const titleId = useId();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (!open) return;
    window.addEventListener("keydown", onKey);
    // El fondo no debe desplazarse bajo la hoja (en iOS arrastraba la página).
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const isMobile = typeof window !== "undefined" && window.matchMedia?.(mobileQuery).matches;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            initial={isMobile ? { y: "100%" } : { opacity: 0, scale: 0.96, y: 8 }}
            animate={isMobile ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={isMobile ? { y: "100%" } : { opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: isMobile ? 0.24 : 0.18, ease: "easeOut" }}
            className={cn(
              "gt-surface-pop relative w-full overflow-y-auto overscroll-contain",
              // Móvil: hoja inferior bajo la zona segura superior.
              "rounded-b-none sm:rounded-b-[var(--radius-lg)] max-h-[calc(100dvh-env(safe-area-inset-top)-12px)] sm:max-h-[90vh]",
              "pb-[env(safe-area-inset-bottom)] sm:pb-0 gt-safe-x sm:px-0",
              size === "sm" && "sm:max-w-md",
              size === "md" && "sm:max-w-lg",
              size === "lg" && "sm:max-w-2xl"
            )}
          >
            {title && (
              <div className="sticky top-0 z-10 bg-surface p-5 pb-4 border-b border-b-theme border-border flex items-start justify-between gap-4">
                <span className="sm:hidden absolute left-1/2 -translate-x-1/2 top-2 h-1.5 w-10 rounded-full bg-border" aria-hidden />
                <div className="min-w-0">
                  <h2 id={titleId} className="gt-heading text-lg">
                    {title}
                  </h2>
                  {description && <p className="text-sm text-subtle mt-1">{description}</p>}
                </div>
                <button onClick={onClose} className="text-subtle hover:text-text h-11 w-11 -m-2.5 flex items-center justify-center rounded-md shrink-0" aria-label="Cerrar">
                  <X size={20} />
                </button>
              </div>
            )}
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
