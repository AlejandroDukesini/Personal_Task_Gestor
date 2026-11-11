import { useEffect, useId, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Pie fijo (botones de guardar/cancelar). */
  footer?: ReactNode;
  width?: "md" | "lg";
}

/**
 * Panel lateral: se desliza desde la derecha y deja ver la vista de detrás,
 * así el usuario no pierde el contexto (la lista, la línea del tiempo…). En el
 * móvil ocupa toda la pantalla. Escape o clic fuera lo cierran.
 */
export function SidePanel({ open, onClose, title, description, children, footer, width = "md" }: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/30" onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={cn(
              "gt-surface-pop relative h-[100dvh] w-full flex flex-col rounded-none",
              "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
              width === "md" ? "sm:max-w-md" : "sm:max-w-xl"
            )}
          >
            <header className="p-5 pb-4 border-b border-b-theme border-border flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id={titleId} className="gt-heading text-lg break-words">
                  {title}
                </h2>
                {description && <p className="text-sm text-subtle mt-1">{description}</p>}
              </div>
              <button onClick={onClose} className="text-subtle hover:text-text h-11 w-11 -m-2.5 flex items-center justify-center rounded-md shrink-0" aria-label="Cerrar">
                <X size={20} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
            {footer && <footer className="p-4 border-t border-t-theme border-border flex justify-end gap-2">{footer}</footer>}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
