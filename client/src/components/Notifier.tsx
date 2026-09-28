import { useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { Bell } from "lucide-react";
import { api } from "@/services/api";
import { useConfig } from "@/store/config";
import { notify, shouldFireDaily } from "@/lib/notifications";
import type { Habit, Reminder, Task } from "@/types";

const TICK_MS = 30000;

/**
 * Motor de avisos. Corre un único temporizador que en cada vuelta:
 *
 *   1. entrega los recordatorios vencidos (tarea/hábito/evento),
 *   2. lanza el aviso de rutina de hábitos a su hora,
 *   3. lanza el resumen diario de tareas pendientes a su hora.
 *
 * El toast se muestra siempre (la pestaña puede estar en primer plano y las
 * notificaciones del sistema no aparecerían); la notificación nativa solo si
 * el usuario dio permiso. No renderiza nada.
 */
export function Notifier() {
  const notificationsEnabled = useConfig((s) => s.notificationsEnabled);
  const habitReminderTime = useConfig((s) => s.habitReminderTime);
  const dailyDigestTime = useConfig((s) => s.dailyDigestTime);

  // Se leen por ref para no reiniciar el temporizador cada vez que cambia un
  // ajuste: el intervalo debe ser uno y estable durante toda la sesión.
  const cfg = useRef({ notificationsEnabled, habitReminderTime, dailyDigestTime });
  cfg.current = { notificationsEnabled, habitReminderTime, dailyDigestTime };

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;

    async function deliverReminders() {
      const pending = await api.get<(Reminder & { task?: Task; habit?: Habit; event?: any })[]>(
        "/reminders/pending"
      );
      for (const r of pending) {
        const label = r.task?.title ?? r.habit?.name ?? r.event?.title ?? "Recordatorio";
        const url = r.task ? "/tareas" : r.habit ? "/habitos" : "/calendario";

        toast(
          () => (
            <div className="flex items-start gap-2">
              <Bell size={16} className="text-primary mt-0.5" />
              <div className="text-sm">
                <div className="font-medium">{label}</div>
                <div className="text-xs text-subtle">Recordatorio</div>
              </div>
            </div>
          ),
          { duration: 6000, id: r.id }
        );

        if (cfg.current.notificationsEnabled) {
          await notify(label, { body: "Recordatorio programado", tag: r.id, url });
        }
        await api.patch(`/reminders/${r.id}/deliver`);
      }
    }

    async function habitRoutine() {
      const { habitReminderTime, notificationsEnabled } = cfg.current;
      if (!habitReminderTime || !notificationsEnabled) return;
      if (!shouldFireDaily("habits", habitReminderTime)) return;

      const habits = await api.get<Habit[]>("/habits");
      // Solo cuentan los que aún no están marcados hoy: avisar de lo ya hecho
      // entrena al usuario a ignorar la notificación.
      const pending = habits.filter((h) => !h.stats.last30[h.stats.last30.length - 1]?.done);
      if (pending.length === 0) return;

      await notify("Rutina de hábitos", {
        body:
          pending.length === 1
            ? `Te queda: ${pending[0].name}`
            : `Te quedan ${pending.length} hábitos por marcar hoy.`,
        tag: "habit-routine",
        url: "/habitos",
        requireInteraction: false,
      });
    }

    async function dailyDigest() {
      const { dailyDigestTime, notificationsEnabled } = cfg.current;
      if (!dailyDigestTime || !notificationsEnabled) return;
      if (!shouldFireDaily("digest", dailyDigestTime)) return;

      const tasks = await api.get<Task[]>("/tasks");
      const open = tasks.filter((t) => t.status === "pending" || t.status === "in_progress");
      if (open.length === 0) return;

      const today = new Date();
      today.setHours(23, 59, 59, 999);
      const due = open.filter((t) => t.dueDate && new Date(t.dueDate) <= today);

      await notify("Resumen del día", {
        body: `${open.length} tarea(s) abiertas${due.length ? ` · ${due.length} vencen hoy` : ""}.`,
        tag: "daily-digest",
        url: "/tareas",
      });
    }

    async function tick() {
      // Cada bloque va aislado: que falle el resumen no debe impedir que se
      // entreguen los recordatorios en la misma vuelta.
      for (const step of [deliverReminders, habitRoutine, dailyDigest]) {
        try {
          await step();
        } catch {
          /* almacenamiento no disponible: se reintenta en la siguiente vuelta */
        }
      }
      if (!stopped) timer = window.setTimeout(tick, TICK_MS);
    }

    tick();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return null;
}
