import { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock,
  Flame,
  ListTodo,
  Target,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Progress } from "@/components/ui/Progress";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/PageHeader";
import { useResource } from "@/hooks/useResource";
import { api } from "@/services/api";
import type { Habit, Stats, Task, Event, Goal } from "@/types";
import { priorityColor, priorityLabel, relativeDay } from "@/lib/utils";

export function Dashboard() {
  const stats = useResource(() => api.get<Stats>("/stats/summary"));
  const tasks = useResource(() => api.get<Task[]>("/tasks?status=pending"));
  const habits = useResource(() => api.get<Habit[]>("/habits"));
  const events = useResource(() => api.get<Event[]>("/events"));
  const goals = useResource(() => api.get<Goal[]>("/goals"));

  const today = useMemo(() => new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }), []);

  return (
    <>
      <PageHeader
        title={`Buen día`}
        description={today.charAt(0).toUpperCase() + today.slice(1)}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi
          icon={CheckCircle2}
          label="Hoy completadas"
          value={stats.data?.completedToday ?? 0}
          color="#10b981"
        />
        <Kpi
          icon={ListTodo}
          label="Pendientes"
          value={stats.data?.pendingTasks ?? 0}
          color="#6366f1"
        />
        <Kpi
          icon={Activity}
          label="Hábitos activos"
          value={stats.data?.activeHabits ?? 0}
          color="#0ea5e9"
        />
        <Kpi
          icon={TrendingUp}
          label="Semana"
          value={stats.data?.completedThisWeek ?? 0}
          color="#f59e0b"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Productividad */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Productividad (últimos 30 días)</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.data?.dailyCompletion ?? []}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="rgb(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" hide />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    background: "rgb(var(--surface))",
                    border: "1px solid rgb(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="rgb(var(--primary))"
                  strokeWidth={2}
                  fill="url(#g1)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Hábitos semana */}
        <Card>
          <CardHeader>
            <CardTitle>Hábitos esta semana</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.data?.habitDaily ?? []}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "rgb(var(--subtle))" }}
                  tickFormatter={(d) =>
                    new Date(d).toLocaleDateString("es-ES", { weekday: "short" }).slice(0, 2)
                  }
                />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    background: "rgb(var(--surface))",
                    border: "1px solid rgb(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" fill="rgb(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Tareas pendientes */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Tareas pendientes</CardTitle>
            <Link to="/tareas" className="text-xs text-primary flex items-center gap-1">
              Ver todas <ArrowRight size={12} />
            </Link>
          </CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto">
            {(tasks.data ?? []).slice(0, 8).map((t, idx) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted transition-colors"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: t.category?.color ?? "#94a3b8" }}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{t.title}</div>
                  <div className="text-xs text-subtle flex items-center gap-2">
                    {t.category && <span>{t.category.name}</span>}
                    {t.dueDate && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Clock size={11} /> {relativeDay(t.dueDate)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <Badge className={priorityColor(t.priority)}>{priorityLabel(t.priority)}</Badge>
              </motion.div>
            ))}
            {tasks.data?.length === 0 && (
              <p className="text-sm text-subtle text-center py-6">No hay tareas pendientes ✨</p>
            )}
          </CardContent>
        </Card>

        {/* Hábitos hoy */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Hábitos hoy</CardTitle>
            <Link to="/habitos" className="text-xs text-primary flex items-center gap-1">
              Ver <ArrowRight size={12} />
            </Link>
          </CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto">
            {(habits.data ?? []).slice(0, 6).map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between gap-2 p-2 rounded-lg border border-border"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ background: h.color }}
                  />
                  <span className="text-sm font-medium truncate">{h.name}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-subtle">
                  <Flame size={12} className="text-orange-500" />
                  {h.stats.streak}d
                </div>
              </div>
            ))}
            {habits.data?.length === 0 && (
              <p className="text-sm text-subtle text-center py-6">Sin hábitos</p>
            )}
          </CardContent>
        </Card>

        {/* Próximos eventos */}
        <Card>
          <CardHeader>
            <CardTitle>Próximos eventos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(events.data ?? [])
              .filter((e) => new Date(e.end) >= new Date())
              .slice(0, 4)
              .map((e) => (
                <div key={e.id} className="p-3 rounded-lg border border-border">
                  <div className="text-sm font-medium truncate">{e.title}</div>
                  <div className="text-xs text-subtle">{relativeDay(e.start)}</div>
                </div>
              ))}
            {(events.data ?? []).filter((e) => new Date(e.end) >= new Date()).length === 0 && (
              <p className="text-sm text-subtle text-center py-6">Sin eventos próximos</p>
            )}
          </CardContent>
        </Card>

        {/* Objetivos */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Progreso de objetivos</CardTitle>
            <Link to="/objetivos" className="text-xs text-primary flex items-center gap-1">
              Ver todos <ArrowRight size={12} />
            </Link>
          </CardHeader>
          <CardContent className="space-y-4">
            {(goals.data ?? []).slice(0, 4).map((g) => {
              const pct = Math.min(100, (g.currentValue / g.targetValue) * 100);
              return (
                <div key={g.id}>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <div className="flex items-center gap-2">
                      <Target size={14} className="text-primary" />
                      <span className="font-medium">{g.title}</span>
                    </div>
                    <span className="text-xs text-subtle">
                      {g.currentValue}/{g.targetValue} {g.unit ?? ""}
                    </span>
                  </div>
                  <Progress value={pct} />
                </div>
              );
            })}
            {goals.data?.length === 0 && (
              <p className="text-sm text-subtle text-center py-6">Sin objetivos definidos</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: any;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3">
        <div
          className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${color}1F`, color }}
        >
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-subtle uppercase tracking-wide">{label}</div>
          <div className="text-2xl font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
