import { lazy, Suspense, useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { AppLayout } from "./layouts/AppLayout";
import { Notifier } from "./components/Notifier";
import { useTheme } from "./store/theme";
import { useConfig } from "./store/config";
import { PinGate } from "./components/PinGate";

// Code splitting por ruta: cada vista se carga bajo demanda (dynamic import).
// Las dependencias pesadas (FullCalendar, Recharts) quedan fuera del bundle
// inicial y solo se descargan cuando el usuario entra a esa sección.
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Tasks = lazy(() => import("./pages/Tasks").then((m) => ({ default: m.Tasks })));
const Habits = lazy(() => import("./pages/Habits").then((m) => ({ default: m.Habits })));
const CalendarPage = lazy(() => import("./pages/Calendar").then((m) => ({ default: m.CalendarPage })));
const Categories = lazy(() => import("./pages/Categories").then((m) => ({ default: m.Categories })));
const Tags = lazy(() => import("./pages/Tags").then((m) => ({ default: m.Tags })));
const Goals = lazy(() => import("./pages/Goals").then((m) => ({ default: m.Goals })));
const Stats = lazy(() => import("./pages/Stats").then((m) => ({ default: m.Stats })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));

function RouteFallback() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent opacity-40" />
    </div>
  );
}

export default function App() {
  const applyDom = useTheme((s) => s.applyDom);
  const loadConfig = useConfig((s) => s.load);
  useEffect(() => {
    applyDom();
    loadConfig().catch(() => {});
  }, [applyDom, loadConfig]);

  return (
    <PinGate>
      <Notifier />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="/tareas" element={<Tasks />} />
            <Route path="/habitos" element={<Habits />} />
            <Route path="/calendario" element={<CalendarPage />} />
            <Route path="/categorias" element={<Categories />} />
            <Route path="/etiquetas" element={<Tags />} />
            <Route path="/objetivos" element={<Goals />} />
            <Route path="/estadisticas" element={<Stats />} />
            <Route path="/configuracion" element={<SettingsPage />} />
          </Route>
        </Routes>
      </Suspense>
    </PinGate>
  );
}
