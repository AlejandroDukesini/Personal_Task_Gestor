import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  Activity,
  BarChart3,
  Bell,
  Calendar,
  CheckSquare,
  CornerDownLeft,
  Download,
  Folder,
  LayoutDashboard,
  Moon,
  Palette,
  Plus,
  Search,
  Settings as SettingsIcon,
  Smartphone,
  Sun,
  Tag,
  Target,
  Wifi,
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  type LucideIcon,
  StickyNote,
} from "lucide-react";
import { useTheme } from "@/store/theme";
import { usePalette } from "@/store/palette";
import { SKINS } from "@/themes/registry";
import { api } from "@/services/api";
import { requestNotificationPermission, notify } from "@/lib/notifications";
import { promptInstall } from "@/lib/pwa";
import { cn } from "@/lib/utils";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  keywords?: string;
  run: () => void | Promise<void>;
}

/**
 * Paleta de comandos (Ctrl/⌘+K).
 *
 * Es el atajo transversal de la app: navegar, cambiar de skin y lanzar
 * acciones rápidas sin sacar las manos del teclado. El filtro es por subcadena
 * sobre etiqueta + palabras clave, suficiente para un catálogo de este tamaño
 * y sin dependencias externas.
 */
export function CommandPalette() {
  const { open, setOpen } = usePalette();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { theme, setTheme, setSkin, skin } = useTheme();

  // Atajo global. Se registra en captura para ganarle al navegador en los
  // casos en que Ctrl+K está asignado a la barra de direcciones.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        usePalette.getState().toggle();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // El input se monta con la animación: se enfoca en el siguiente frame.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to);
    const nav: Command[] = [
      { id: "nav-dash", group: "Ir a", label: "Dashboard", icon: LayoutDashboard, keywords: "inicio home panel", run: go("/") },
      { id: "nav-tasks", group: "Ir a", label: "Tareas", icon: CheckSquare, keywords: "todo pendientes", run: go("/tareas") },
      { id: "nav-notes", group: "Ir a", label: "Notas", icon: StickyNote, keywords: "apuntes documentos adjuntos calculos", run: go("/notas") },
      { id: "nav-habits", group: "Ir a", label: "Hábitos", icon: Activity, keywords: "rachas streak", run: go("/habitos") },
      { id: "nav-cal", group: "Ir a", label: "Calendario", icon: Calendar, keywords: "eventos agenda", run: go("/calendario") },
      { id: "nav-cats", group: "Ir a", label: "Categorías", icon: Folder, run: go("/categorias") },
      { id: "nav-tags", group: "Ir a", label: "Etiquetas", icon: Tag, run: go("/etiquetas") },
      { id: "nav-goals", group: "Ir a", label: "Objetivos", icon: Target, keywords: "metas", run: go("/objetivos") },
      { id: "nav-finance", group: "Ir a", label: "Finanzas", icon: Wallet, keywords: "dinero cuentas presupuesto ahorro gastos", run: go("/finanzas") },
      { id: "nav-stats", group: "Ir a", label: "Estadísticas", icon: BarChart3, keywords: "graficas metricas", run: go("/estadisticas") },
      { id: "nav-settings", group: "Ir a", label: "Configuración", icon: SettingsIcon, keywords: "ajustes preferencias", run: go("/configuracion") },
    ];

    const themes: Command[] = SKINS.map((s) => ({
      id: `skin-${s.id}`,
      group: "Tema",
      label: `Tema: ${s.name}`,
      hint: s.id === skin ? "activo" : undefined,
      icon: Palette,
      keywords: `skin apariencia estilo ${s.id} ${s.description}`,
      run: () => {
        setSkin(s.id);
        toast.success(`Tema «${s.name}» aplicado`);
      },
    }));

    const actions: Command[] = [
      {
        id: "mode-toggle",
        group: "Tema",
        label: theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro",
        icon: theme === "dark" ? Sun : Moon,
        keywords: "dark light oscuro claro modo",
        run: () => setTheme(theme === "dark" ? "light" : "dark"),
      },
      {
        id: "task-new",
        group: "Acciones",
        label: "Nueva tarea",
        hint: "abre el formulario",
        icon: Plus,
        keywords: "crear añadir todo",
        run: () => navigate("/tareas?new=1"),
      },
      {
        id: "note-new",
        group: "Acciones",
        label: "Nueva nota",
        hint: "título y a escribir",
        icon: StickyNote,
        keywords: "crear apunte documento",
        run: () => navigate("/notas?new=1"),
      },
      {
        id: "fin-expense",
        group: "Acciones",
        label: "Registrar gasto",
        icon: ArrowUpRight,
        keywords: "finanzas pago compra dinero",
        run: () => navigate("/finanzas?new=expense"),
      },
      {
        id: "fin-income",
        group: "Acciones",
        label: "Registrar ingreso",
        icon: ArrowDownLeft,
        keywords: "finanzas salario cobro dinero",
        run: () => navigate("/finanzas?new=income"),
      },
      {
        id: "habits-today",
        group: "Acciones",
        label: "Marcar todos los hábitos de hoy",
        icon: Activity,
        keywords: "racha check completar",
        run: async () => {
          const habits = await api.get<{ id: string; name: string }[]>("/habits");
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          for (const h of habits) {
            await api.post(`/habits/${h.id}/logs`, { date: today.toISOString() });
          }
          toast.success(`${habits.length} hábito(s) marcados`);
        },
      },
      {
        id: "backup",
        group: "Acciones",
        label: "Exportar copia de seguridad (JSON)",
        icon: Download,
        keywords: "backup guardar datos exportar",
        run: async () => {
          const blob = await api.get<unknown>("/backup/export");
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(blob, null, 2)], { type: "application/json" })
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = `backup-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success("Copia exportada");
        },
      },
      {
        id: "notif",
        group: "Acciones",
        label: "Activar notificaciones del navegador",
        icon: Bell,
        keywords: "avisos alertas permiso notification",
        run: async () => {
          const granted = await requestNotificationPermission();
          if (granted) {
            await notify("Notificaciones activadas", { body: "Te avisaremos de tus rutinas." });
            toast.success("Notificaciones activadas");
          } else {
            toast.error("Permiso denegado por el navegador");
          }
        },
      },
      {
        id: "sync",
        group: "Acciones",
        label: "Sincronizar (Wi‑Fi o archivo)",
        icon: Wifi,
        keywords: "qr wifi lan movil telefono sync",
        run: () => navigate("/sincronizacion"),
      },
      {
        id: "install",
        group: "Acciones",
        label: "Instalar la app (PWA)",
        icon: Smartphone,
        keywords: "pwa instalar escritorio movil",
        run: async () => {
          const done = await promptInstall();
          if (!done) toast("La app ya está instalada o el navegador no lo permite");
        },
      },
    ];

    return [...nav, ...themes, ...actions];
  }, [navigate, setSkin, setTheme, theme, skin]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    // Se normalizan acentos para que "habitos" encuentre "Hábitos".
    // La clase U+0300..U+036F son las marcas que NFD separa de la letra base.
    const norm = (s: string) =>
      s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const nq = norm(q);
    return commands.filter((c) => norm(`${c.label} ${c.group} ${c.keywords ?? ""}`).includes(nq));
  }, [commands, query]);

  useEffect(() => setCursor(0), [query]);

  // Mantiene visible el elemento seleccionado al navegar con el teclado.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: "nearest",
    });
  }, [cursor]);

  async function execute(cmd: Command | undefined) {
    if (!cmd) return;
    setOpen(false);
    try {
      await cmd.run();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo ejecutar la acción");
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (results.length ? (c + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      execute(results[cursor]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  // Se renderiza en un portal para que ningún `overflow` o `transform` de la
  // jerarquía recorte el diálogo.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Paleta de comandos"
            initial={{ opacity: 0, scale: 0.98, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -8 }}
            transition={{ duration: 0.14 }}
            className="gt-surface-pop relative w-full max-w-xl overflow-hidden"
          >
            <div className="flex items-center gap-2 px-4 border-b border-b-theme border-border">
              <Search size={16} className="text-subtle shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Buscar comandos, vistas o temas..."
                aria-label="Buscar comandos"
                className="flex-1 bg-transparent h-12 text-sm outline-none placeholder:text-subtle"
              />
              <kbd className="gt-mono text-[10px] text-subtle border border-border rounded px-1.5 py-0.5">
                ESC
              </kbd>
            </div>

            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="text-sm text-subtle text-center py-8">Sin resultados para «{query}»</p>
              ) : (
                results.map((cmd, i) => {
                  const first = i === 0 || results[i - 1].group !== cmd.group;
                  return (
                    <div key={cmd.id}>
                      {first && (
                        <div className="px-2 pt-3 pb-1 text-[10px] uppercase tracking-wider text-subtle">
                          {cmd.group}
                        </div>
                      )}
                      <button
                        type="button"
                        data-active={i === cursor}
                        onMouseMove={() => setCursor(i)}
                        onClick={() => execute(cmd)}
                        className={cn(
                          "w-full flex items-center gap-3 px-2 py-2 rounded text-sm text-left",
                          i === cursor ? "bg-primary/15 text-primary" : "hover:bg-muted"
                        )}
                      >
                        <cmd.icon size={15} className="shrink-0" />
                        <span className="flex-1 truncate">{cmd.label}</span>
                        {cmd.hint && <span className="text-xs text-subtle">{cmd.hint}</span>}
                        {i === cursor && <CornerDownLeft size={13} className="shrink-0 opacity-60" />}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="border-t border-t-theme border-border px-4 py-2 flex items-center gap-3 text-[11px] text-subtle">
              <span className="flex items-center gap-1">
                <kbd className="gt-mono border border-border rounded px-1">↑</kbd>
                <kbd className="gt-mono border border-border rounded px-1">↓</kbd> navegar
              </span>
              <span className="flex items-center gap-1">
                <kbd className="gt-mono border border-border rounded px-1">↵</kbd> ejecutar
              </span>
              <span className="ml-auto flex items-center gap-1">
                <kbd className="gt-mono border border-border rounded px-1">Ctrl</kbd>
                <kbd className="gt-mono border border-border rounded px-1">K</kbd>
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
