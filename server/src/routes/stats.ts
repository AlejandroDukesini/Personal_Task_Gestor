import { Router } from "express";
import { prisma } from "../db";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

router.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    const today = startOfDay(new Date());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 29);

    const [totalTasks, completedToday, pendingTasks, completedThisWeek, habits, habitLogsWeek] =
      await Promise.all([
        prisma.task.count(),
        prisma.task.count({ where: { status: "completed", completedAt: { gte: today } } }),
        prisma.task.count({ where: { status: { in: ["pending", "in_progress"] } } }),
        prisma.task.count({ where: { status: "completed", completedAt: { gte: weekAgo } } }),
        prisma.habit.findMany({ where: { archived: false } }),
        prisma.habitLog.findMany({ where: { date: { gte: weekAgo } } }),
      ]);

    // Tareas completadas por día - últimos 30 días
    const allCompleted = await prisma.task.findMany({
      where: { status: "completed", completedAt: { gte: monthAgo } },
      select: { completedAt: true },
    });
    const dailyCompletion = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (29 - i));
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      return {
        date: d.toISOString().slice(0, 10),
        count: allCompleted.filter((t) => t.completedAt && t.completedAt >= d && t.completedAt < next).length,
      };
    });

    // Cumplimiento de hábitos por día
    const habitDaily = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (6 - i));
      const count = habitLogsWeek.filter(
        (l) => startOfDay(new Date(l.date)).getTime() === d.getTime()
      ).length;
      return { date: d.toISOString().slice(0, 10), count, total: habits.length };
    });

    res.json({
      totalTasks,
      completedToday,
      pendingTasks,
      completedThisWeek,
      activeHabits: habits.length,
      dailyCompletion,
      habitDaily,
    });
  })
);

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default router;
