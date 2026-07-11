import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
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
  Menu,
  X,
  Moon,
  Sun,
  Laptop,
} from "lucide-react";
import { useTheme } from "@/store/theme";
import { useConfig } from "@/store/config";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", icon: LayoutDashboard, label: "nav.dashboard" },
  { to: "/tareas", icon: CheckSquare, label: "nav.tasks" },
  { to: "/habitos", icon: Activity, label: "nav.habits" },
  { to: "/calendario", icon: Calendar, label: "nav.calendar" },
  { to: "/categorias", icon: Folder, label: "nav.categories" },
  { to: "/etiquetas", icon: Tag, label: "nav.tags" },
  { to: "/objetivos", icon: Target, label: "nav.goals" },
  { to: "/estadisticas", icon: BarChart3, label: "nav.stats" },
  { to: "/configuracion", icon: SettingsIcon, label: "nav.settings" },
];

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  return (
    <div className="min-h-screen flex bg-bg text-text">
      <Sidebar />

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-0 z-40 md:hidden transition-opacity",
          open ? "visible opacity-100" : "invisible opacity-0"
        )}
      >
        <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
        <aside
          className={cn(
            "absolute left-0 top-0 h-full w-64 bg-surface border-r border-border transition-transform",
            open ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <SidebarContent onClose={() => setOpen(false)} />
        </aside>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onMenu={() => setOpen(true)} />
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="hidden md:flex md:w-60 lg:w-64 shrink-0 border-r border-border bg-surface flex-col">
      <SidebarContent />
    </aside>
  );
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const t = useT();
  const appName = useConfig((s) => s.appName);
  const appLogo = useConfig((s) => s.appLogo);
  const isImage = !!appLogo && appLogo.startsWith("data:");
  return (
    <div className="h-full flex flex-col">
      <div className="h-14 flex items-center justify-between px-4 border-b border-border">
        <div className="flex items-center gap-2 font-semibold min-w-0">
          <div className="h-8 w-8 rounded-lg bg-primary text-primary-fg flex items-center justify-center text-sm font-bold overflow-hidden shrink-0">
            {isImage ? (
              <img src={appLogo!} alt={appName} className="h-full w-full object-cover" />
            ) : (
              appLogo || appName.charAt(0).toUpperCase() || "P"
            )}
          </div>
          <span className="truncate">{appName}</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="md:hidden text-subtle">
            <X size={18} />
          </button>
        )}
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {nav.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-subtle hover:text-text hover:bg-muted"
              )
            }
          >
            <it.icon size={18} />
            {t(it.label)}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-border text-xs text-subtle">
        v1.0.0 · {t("nav.localData")}
      </div>
    </div>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { theme, setTheme } = useTheme();
  const t = useT();
  const cycle = () => setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light");
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Laptop;
  return (
    <header className="h-14 border-b border-border bg-surface/80 backdrop-blur flex items-center px-4 sm:px-6 lg:px-8 sticky top-0 z-30">
      <button
        onClick={onMenu}
        className="md:hidden mr-3 p-1.5 rounded-md hover:bg-muted text-subtle"
        aria-label={t("nav.openMenu")}
      >
        <Menu size={18} />
      </button>
      <div className="flex-1" />
      <button
        onClick={cycle}
        className="p-2 rounded-md hover:bg-muted text-subtle"
        title={`Tema: ${theme}`}
      >
        <Icon size={18} />
      </button>
    </header>
  );
}
