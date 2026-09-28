import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { useResource } from "@/hooks/useResource";
import { api } from "@/services/api";
import type { Habit, Stats as StatsType, Task } from "@/types";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9", "#8b5cf6"];

export function Stats() {
  const stats = useResource(() => api.get<StatsType>("/stats/summary"));
  const tasks = useResource(() => api.get<Task[]>("/tasks"));
  const habits = useResource(() => api.get<Habit[]>("/habits"));

  const priorityData = (() => {
    const groups: Record<string, number> = { Crítica: 0, Alta: 0, Media: 0, Baja: 0 };
    const map: any = { critical: "Crítica", high: "Alta", medium: "Media", low: "Baja" };
    (tasks.data ?? []).forEach((t) => (groups[map[t.priority]] = (groups[map[t.priority]] ?? 0) + 1));
    return Object.entries(groups).map(([name, value]) => ({ name, value }));
  })();

  // Productividad: se calcula sobre las tareas reales, sin estimaciones.
  const productivity = (() => {
    const list = tasks.data ?? [];
    const done = list.filter((t) => t.status === "completed" && t.completedAt);
    const relevant = list.filter((t) => t.status !== "cancelled");
    const withDue = done.filter((t) => t.dueDate);
    const onTime = withDue.filter((t) => t.completedAt!.slice(0, 10) <= t.dueDate!.slice(0, 10));
    const days = done.map((t) => (Date.parse(t.completedAt!) - Date.parse(t.createdAt)) / 86400000).filter((d) => d >= 0);
    const weekday = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((name) => ({ name, value: 0 }));
    for (const t of done) weekday[new Date(t.completedAt!).getDay()].value++;
    const byCat = new Map<string, number>();
    for (const t of done) byCat.set(t.category?.name ?? "Sin categoría", (byCat.get(t.category?.name ?? "Sin categoría") ?? 0) + 1);
    return {
      completionRate: relevant.length ? (done.length / relevant.length) * 100 : null,
      onTimeRate: withDue.length ? (onTime.length / withDue.length) * 100 : null,
      avgDays: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null,
      done: done.length,
      weekday: [...weekday.slice(1), weekday[0]],
      byCategory: [...byCat.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8),
    };
  })();

  const habitData = (habits.data ?? []).map((h) => ({
    name: h.name,
    racha: h.stats.streak,
    mejor: h.stats.best,
  }));

  return (
    <>
      <PageHeader title="Estadísticas" description="Visualiza tu productividad." />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          ["Completadas", String(productivity.done)],
          ["Tasa de finalización", productivity.completionRate === null ? "—" : `${productivity.completionRate.toFixed(0)} %`],
          ["A tiempo", productivity.onTimeRate === null ? "—" : `${productivity.onTimeRate.toFixed(0)} %`],
          ["Días hasta completar", productivity.avgDays === null ? "—" : productivity.avgDays.toFixed(1)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent>
              <div className="text-xs text-subtle uppercase tracking-wide">{label}</div>
              <div className="text-2xl font-semibold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Tareas completadas por día de la semana</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={productivity.weekday}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgb(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "rgb(var(--subtle))" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "rgb(var(--subtle))" }} />
                <Tooltip contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--border))", borderRadius: 8 }} />
                <Bar dataKey="value" name="Completadas" fill="rgb(var(--chart-1))" radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Completadas por categoría</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {productivity.byCategory.length === 0 ? (
              <p className="text-sm text-subtle text-center py-10">Aún no hay tareas completadas.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={productivity.byCategory} layout="vertical">
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="rgb(var(--border))" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "rgb(var(--subtle))" }} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: "rgb(var(--subtle))" }} />
                  <Tooltip contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--border))", borderRadius: 8 }} />
                  <Bar dataKey="value" name="Completadas" fill="rgb(var(--chart-1))" radius={[0, 4, 4, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tareas completadas (30 días)</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.data?.dailyCompletion ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "rgb(var(--subtle))" }}
                  tickFormatter={(d) => new Date(d).getDate().toString()}
                />
                <YAxis tick={{ fontSize: 11, fill: "rgb(var(--subtle))" }} />
                <Tooltip
                  contentStyle={{
                    background: "rgb(var(--surface))",
                    border: "1px solid rgb(var(--border))",
                    borderRadius: 8,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="rgb(var(--primary))"
                  fill="rgb(var(--primary))"
                  fillOpacity={0.3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tareas por prioridad</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={priorityData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label
                >
                  {priorityData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "rgb(var(--surface))",
                    border: "1px solid rgb(var(--border))",
                    borderRadius: 8,
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Rachas de hábitos</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={habitData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "rgb(var(--subtle))" }} />
                <YAxis tick={{ fontSize: 11, fill: "rgb(var(--subtle))" }} />
                <Tooltip
                  contentStyle={{
                    background: "rgb(var(--surface))",
                    border: "1px solid rgb(var(--border))",
                    borderRadius: 8,
                  }}
                />
                <Legend />
                <Bar dataKey="racha" fill="rgb(var(--primary))" radius={[6, 6, 0, 0]} />
                <Bar dataKey="mejor" fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
