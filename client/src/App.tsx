import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { AppLayout } from "./layouts/AppLayout";
import { Notifier } from "./components/Notifier";
import { Dashboard } from "./pages/Dashboard";
import { Tasks } from "./pages/Tasks";
import { Habits } from "./pages/Habits";
import { CalendarPage } from "./pages/Calendar";
import { Categories } from "./pages/Categories";
import { Tags } from "./pages/Tags";
import { Goals } from "./pages/Goals";
import { Stats } from "./pages/Stats";
import { SettingsPage } from "./pages/Settings";
import { useTheme } from "./store/theme";

export default function App() {
  const applyDom = useTheme((s) => s.applyDom);
  useEffect(() => {
    applyDom();
  }, [applyDom]);

  return (
    <>
      <Notifier />
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
    </>
  );
}
