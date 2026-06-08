import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

router.get(
  "/export",
  asyncHandler(async (_req, res) => {
    const [categories, tags, tasks, taskTags, habits, habitLogs, events, reminders, goals, settings] =
      await Promise.all([
        prisma.category.findMany(),
        prisma.tag.findMany(),
        prisma.task.findMany(),
        prisma.taskTag.findMany(),
        prisma.habit.findMany(),
        prisma.habitLog.findMany(),
        prisma.event.findMany(),
        prisma.reminder.findMany(),
        prisma.goal.findMany(),
        prisma.settings.findUnique({ where: { id: 1 } }),
      ]);
    res.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        categories,
        tags,
        tasks,
        taskTags,
        habits,
        habitLogs,
        events,
        reminders,
        goals,
        settings,
      },
    });
  })
);

router.post(
  "/import",
  asyncHandler(async (req, res) => {
    const schema = z.object({
      data: z.object({
        categories: z.array(z.any()).optional(),
        tags: z.array(z.any()).optional(),
        tasks: z.array(z.any()).optional(),
        habits: z.array(z.any()).optional(),
        habitLogs: z.array(z.any()).optional(),
        events: z.array(z.any()).optional(),
        reminders: z.array(z.any()).optional(),
        goals: z.array(z.any()).optional(),
        settings: z.any().optional(),
      }),
      replace: z.boolean().optional(),
    });
    const { data, replace } = schema.parse(req.body);

    if (replace) {
      await prisma.$transaction([
        prisma.reminder.deleteMany(),
        prisma.habitLog.deleteMany(),
        prisma.taskTag.deleteMany(),
        prisma.task.deleteMany(),
        prisma.habit.deleteMany(),
        prisma.event.deleteMany(),
        prisma.goal.deleteMany(),
        prisma.tag.deleteMany(),
        prisma.category.deleteMany(),
      ]);
    }

    // Inserción en orden
    for (const c of data.categories ?? []) await prisma.category.upsert({ where: { id: c.id }, create: c, update: c });
    for (const t of data.tags ?? []) await prisma.tag.upsert({ where: { id: t.id }, create: t, update: t });
    for (const t of data.tasks ?? []) {
      const { tags: _tags, ...rest } = t;
      await prisma.task.upsert({ where: { id: rest.id }, create: rest, update: rest });
    }
    for (const tt of (data as any).taskTags ?? []) {
      await prisma.taskTag
        .upsert({
          where: { taskId_tagId: { taskId: tt.taskId, tagId: tt.tagId } },
          create: tt,
          update: tt,
        })
        .catch(() => null);
    }
    for (const h of data.habits ?? []) await prisma.habit.upsert({ where: { id: h.id }, create: h, update: h });
    for (const l of data.habitLogs ?? [])
      await prisma.habitLog.upsert({ where: { id: l.id }, create: l, update: l });
    for (const e of data.events ?? []) await prisma.event.upsert({ where: { id: e.id }, create: e, update: e });
    for (const r of data.reminders ?? [])
      await prisma.reminder.upsert({ where: { id: r.id }, create: r, update: r });
    for (const g of data.goals ?? []) await prisma.goal.upsert({ where: { id: g.id }, create: g, update: g });

    res.json({ ok: true });
  })
);

export default router;
