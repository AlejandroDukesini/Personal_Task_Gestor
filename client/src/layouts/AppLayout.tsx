import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard,
  CheckSquare,
  Activity,
  Calendar,
  Folder,
  Tag,
  Target,
  BarChart3,
  Settings as SettingsIcon,
  Moon,
  Sun,
  Laptop,
  Search,
  Wallet,
  StickyNote,
  RefreshCw,
  MoreHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "@/store/theme";
import { useConfig } from "@/store/config";
import { usePalette } from "@/store/palette";
import { useSyncCenter } from "@/store/syncCenter";
import { UpdateBanner } from "@/components/UpdateBanner";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
}

const nav: NavItem[] = [
  { to: "/", icon: LayoutDashboard, label: "nav.dashboard" },
  { to: "/tareas", icon: CheckSquare, label: "nav.tasks" },
  { to: "/notas", icon: StickyNote, label: "nav.notes" },
  { to: "/habitos", icon: Activity, label: "nav.habits" },
  { to: "/calendario", icon: Calendar, label: "nav.calendar" },
  { to: "/categorias", icon: Folder, label: "nav.categories" },
  { to: "/etiquetas", icon: Tag, label: "nav.tags" },
  { to: "/objetivos", icon: Target, label: "nav.goals" },
  { to: "/finanzas", icon: Wallet, label: "nav.finance" },
  { to: "/estadisticas", icon: BarChart3, label: "nav.stats" },
  { to: "/sincronizacion", icon: RefreshCw, label: "nav.sync" },
  { to: "/configuracion", icon: SettingsIcon, label: "nav.settings" },
];

/** Pestañas fijas del móvil: lo que se usa a diario, al alcance del pulgar. */
const TABS: NavItem[] = [
  { to: "/", icon: LayoutDashboard, label: "nav.home" },
  { to: "/tareas", icon: CheckSquare, label: "nav.tasks" },
  { to: "/finanzas", icon: Wallet, label: "nav.finance" },
  { to: "/habitos", icon: Activity, label: "nav.habits" },
];
const MORE = nav.filter((n) => !TABS.some((t) => t.to === n.to));

export function AppLayout() {
  const [more, setMore] = useState(false);
  const loc = useLocation();
  useEffect(() => setMore(false), [loc.pathname]);

  return (
    <div className="min-h-[100dvh] flex bg-bg text-text">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <UpdateBanner />
        {/* En móvil se reserva el alto de la barra de pestañas + el indicador de inicio. */}
        <main className="gt-safe-x [--gt-pad-x:1rem] sm:[--gt-pad-x:1.5rem] lg:[--gt-pad-x:2rem] flex-1 py-5 sm:py-6 pb-[calc(env(safe-area-inset-bottom)+84px)] md:pb-6">
          <Outlet />
        </main>
      </div>

      <TabBar onMore={() => setMore(true)} moreOpen={more} />
      <MoreSheet open={more} onClose={() => setMore(false)} />
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="hidden md:flex md:w-60 lg:w-64 shrink-0 border-r border-r-theme border-border bg-surface/80 backdrop-blur flex-col sticky top-0 h-[100dvh]">
      <SidebarContent />
    </aside>
  );
}

function Brand() {
  const appName = useConfig((s) => s.appName);
  const appLogo = useConfig((s) => s.appLogo);
  const isImage = !!appLogo && appLogo.startsWith("data:");
  return (
    <div className="gt-heading flex items-center gap-2 min-w-0">
      <div className="h-8 w-8 rounded-md bg-primary text-primary-fg flex items-center justify-center text-sm font-bold overflow-hidden shrink-0">
        {isImage ? <img src={appLogo!} alt={appName} className="h-full w-full object-cover" /> : appLogo || appName.charAt(0).toUpperCase() || "P"}
      </div>
      <span className="truncate">{appName}</span>
    </div>
  );
}

function SyncCount() {
  const pending = useSyncCenter((s) => s.pending);
  if (!pending) return null;
  return (
    <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-warning/20 text-warning text-[11px] font-semibold flex items-center justify-center tabular-nums" aria-label={`${pending} cambios sin sincronizar`}>
      {pending > 99 ? "99+" : pending}
    </span>
  );
}

function SidebarContent() {
  const t = useT();
  return (
    <div className="h-full flex flex-col">
      <div className="h-14 flex items-center px-4 border-b border-b-theme border-border">
        <Brand />
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {nav.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                isActive ? "bg-primary/10 text-primary font-medium" : "text-subtle hover:text-text hover:bg-muted"
              )
            }
          >
            <it.icon size={18} />
            {t(it.label)}
            {it.to === "/sincronizacion" && <SyncCount />}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-border text-xs text-subtle">
        v{__APP_VERSION__} · {t("nav.localData")}
      </div>
    </div>
  );
}

function Topbar() {
  const { theme, setTheme } = useTheme();
  const openPalette = usePalette((s) => s.setOpen);
  const pending = useSyncCenter((s) => s.pending);
  const t = useT();
  const cycle = () => setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light");
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Laptop;

  return (
    // La barra se extiende bajo la zona de la cámara (viewport-fit=cover) y
    // su contenido empieza donde acaba la zona segura.
    <header className="gt-safe-x sticky top-0 z-30 border-b border-b-theme border-border bg-surface/85 backdrop-blur pt-[env(safe-area-inset-top)]">
      <div className="h-14 flex items-center gap-2 px-4 sm:px-6 lg:px-8">
        <div className="md:hidden min-w-0 flex-1">
          <Brand />
        </div>

        {/* Disparador visible de la paleta: el atajo Ctrl+K no se descubre solo. */}
        <button
          onClick={() => openPalette(true)}
          className="gt-field hidden md:flex items-center gap-2 h-9 px-3 text-sm text-subtle hover:text-text max-w-xs w-full"
          aria-label={t("palette.open")}
        >
          <Search size={14} className="shrink-0" />
          <span className="truncate">{t("palette.placeholder")}</span>
          <kbd className="gt-mono ml-auto text-[10px] border border-border rounded px-1.5 py-0.5">Ctrl K</kbd>
        </button>
        <button onClick={() => openPalette(true)} className="md:hidden h-11 w-11 flex items-center justify-center rounded-md text-subtle hover:bg-muted" aria-label={t("palette.open")}>
          <Search size={20} />
        </button>

        <div className="flex-1 hidden md:block" />
        <Link
          to="/sincronizacion"
          className="relative h-11 w-11 flex items-center justify-center rounded-md text-subtle hover:bg-muted"
          aria-label={pending ? `Sincronización: ${pending} cambios pendientes` : "Sincronización"}
          title={pending ? `${pending} cambios sin sincronizar` : "Sincronización"}
        >
          <RefreshCw size={19} />
          {!!pending && <span className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-warning ring-2 ring-surface" aria-hidden />}
        </Link>
        <button onClick={cycle} className="h-11 w-11 flex items-center justify-center rounded-md hover:bg-muted text-subtle" title={`Tema: ${theme}`} aria-label={`Tema: ${theme}`}>
          <Icon size={19} />
        </button>
      </div>
    </header>
  );
}

function TabBar({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const t = useT();
  const loc = useLocation();
  const pending = useSyncCenter((s) => s.pending);
  const inMore = MORE.some((m) => loc.pathname.startsWith(m.to));
  return (
    <nav
      className="gt-safe-x md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-surface/90 backdrop-blur pb-[env(safe-area-inset-bottom)]"
      aria-label="Navegación principal"
    >
      <ul className="grid grid-cols-5 h-[60px]">
        {TABS.map((it) => (
          <li key={it.to}>
            <NavLink
              to={it.to}
              end={it.to === "/"}
              className={({ isActive }) =>
                cn("h-full flex flex-col items-center justify-center gap-0.5 text-[11px]", isActive ? "text-primary font-semibold" : "text-subtle")
              }
            >
              <it.icon size={22} aria-hidden />
              {t(it.label)}
            </NavLink>
          </li>
        ))}
        <li>
          <button
            onClick={onMore}
            aria-expanded={moreOpen}
            className={cn("relative h-full w-full flex flex-col items-center justify-center gap-0.5 text-[11px]", inMore || moreOpen ? "text-primary font-semibold" : "text-subtle")}
          >
            <MoreHorizontal size={22} aria-hidden />
            {t("nav.more")}
            {!!pending && <span className="absolute top-2 right-[calc(50%-18px)] h-2.5 w-2.5 rounded-full bg-warning" aria-hidden />}
          </button>
        </li>
      </ul>
    </nav>
  );
}

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="md:hidden fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t("nav.more")}
            className="gt-safe-x absolute bottom-0 inset-x-0 bg-surface rounded-t-2xl border-t border-border pb-[calc(env(safe-area-inset-bottom)+12px)]"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "tween", duration: 0.22 }}
          >
            <div className="flex items-center justify-between px-5 pt-3 pb-2">
              <span className="mx-auto h-1.5 w-10 rounded-full bg-border absolute left-1/2 -translate-x-1/2 top-2" aria-hidden />
              <span className="gt-heading text-base mt-2">{t("nav.more")}</span>
              <button onClick={onClose} className="h-11 w-11 -mr-2 flex items-center justify-center text-subtle" aria-label="Cerrar">
                <X size={20} />
              </button>
            </div>
            <ul className="grid grid-cols-3 gap-2 px-4 pb-2">
              {MORE.map((it) => (
                <li key={it.to}>
                  <NavLink
                    to={it.to}
                    className={({ isActive }) =>
                      cn("relative h-20 rounded-xl flex flex-col items-center justify-center gap-1.5 text-xs border", isActive ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/40")
                    }
                  >
                    <it.icon size={22} aria-hidden />
                    {t(it.label)}
                    {it.to === "/sincronizacion" && (
                      <span className="absolute top-2 right-2">
                        <SyncCount />
                      </span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
