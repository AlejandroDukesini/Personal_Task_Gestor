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

  const habitData = (habits.data ?? []).map((h) => ({
    name: h.name,
    racha: h.stats.streak,
    mejor: h.stats.best,
  }));

  return (
    <>
      <PageHeader title="Estadísticas" description="Visualiza tu productividad." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
