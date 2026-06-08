import { useEffect } from "react";
import toast from "react-hot-toast";
import { Bell } from "lucide-react";
import { api } from "@/services/api";
import type { Reminder } from "@/types";

export function Notifier() {
  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const pending = await api.get<(Reminder & { task?: any; habit?: any; event?: any })[]>(
          "/reminders/pending"
        );
        for (const r of pending) {
          const label = r.task?.title ?? r.habit?.name ?? r.event?.title ?? "Recordatorio";
          toast(
            (t) => (
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
          await api.patch(`/reminders/${r.id}/deliver`);
        }
      } catch {
        /* offline */
      }
      if (!stopped) setTimeout(poll, 30000);
    }
    poll();
    return () => {
      stopped = true;
    };
  }, []);
  return null;
}
