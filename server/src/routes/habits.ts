import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

const dateOrNull = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null || v === "" ? null : new Date(v)));

const upsertSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  color: z.string().optional(),
  icon: z.string().nullable().optional(),
  frequency: z.enum(["daily", "weekly", "monthly", "custom"]).optional(),
  daysOfWeek: z.string().nullable().optional(),
  dailyTarget: z.number().int().min(1).optional(),
  weeklyTarget: z.number().int().min(1).nullable().optional(),
  startDate: dateOrNull,
  endDate: dateOrNull,
  categoryId: z.string().nullable().optional(),
  archived: z.boolean().optional(),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { includeArchived } = req.query as Record<string, string | undefined>;
    const habits = await prisma.habit.findMany({
      where: includeArchived === "true" ? {} : { archived: false },
      orderBy: { createdAt: "asc" },
      include: { category: true, logs: { orderBy: { date: "desc" }, take: 60 } },
    });
    res.json(habits.map(addStats));
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = upsertSchema.parse(req.body);
    const created = await prisma.habit.create({
      data: { ...data, startDate: data.startDate ?? new Date() },
      include: { category: true, logs: true },
    });
    res.status(201).json(addStats(created));
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = upsertSchema.partial().parse(req.body);
    const updated = await prisma.habit.update({
      where: { id: req.params.id },
      data,
      include: { category: true, logs: { orderBy: { date: "desc" }, take: 60 } },
    });
    res.json(addStats(updated));
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.habit.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

// Logs (marcar/desmarcar)
router.post(
  "/:id/logs",
  asyncHandler(async (req, res) => {
    const schema = z.object({ date: z.string(), count: z.number().optional(), note: z.string().optional() });
    const { date, count, note } = schema.parse(req.body);
    const dayStart = startOfDay(new Date(date));
    const existing = await prisma.habitLog.findUnique({
      where: { habitId_date: { habitId: req.params.id, date: dayStart } },
    });
    if (existing) {
      const updated = await prisma.habitLog.update({
        where: { id: existing.id },
        data: { count: count ?? existing.count + 1, note: note ?? existing.note },
      });
      return res.json(updated);
    }
    const created = await prisma.habitLog.create({
      data: { habitId: req.params.id, date: dayStart, count: count ?? 1, note },
    });
    res.status(201).json(created);
  })
);

router.delete(
  "/:id/logs",
  asyncHandler(async (req, res) => {
    const date = String(req.query.date);
    const dayStart = startOfDay(new Date(date));
    await prisma.habitLog.deleteMany({ where: { habitId: req.params.id, date: dayStart } });
    res.status(204).end();
  })
);

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addStats(habit: any) {
  const logs: any[] = habit.logs ?? [];
  // racha actual
  let streak = 0;
  const today = startOfDay(new Date());
  const set = new Set(logs.map((l) => startOfDay(new Date(l.date)).getTime()));
  for (let i = 0; ; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (set.has(d.getTime())) streak++;
    else break;
  }
  // mejor racha
  let best = 0,
    cur = 0;
  const sorted = [...set].sort((a, b) => a - b);
  let prev: number | null = null;
  for (const t of sorted) {
    if (prev === null || t - prev === 86400000) cur++;
    else cur = 1;
    best = Math.max(best, cur);
    prev = t;
  }
  // últimos 30 días
  const last30 = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (29 - i));
    return { date: d.toISOString(), done: set.has(d.getTime()) };
  });
  const successRate = last30.filter((d) => d.done).length / 30;
  return { ...habit, stats: { streak, best, successRate, last30 } };
}

export default router;
