import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

const upsertSchema = z
  .object({
    triggerAt: z.string().transform((s) => new Date(s)),
    minutesBefore: z.number().int().nullable().optional(),
    type: z.enum(["in_app", "banner", "sound"]).optional(),
    taskId: z.string().nullable().optional(),
    habitId: z.string().nullable().optional(),
    eventId: z.string().nullable().optional(),
  })
  .refine((d) => d.taskId || d.habitId || d.eventId, {
    message: "Debe asociarse a tarea, hábito o evento",
  });

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const reminders = await prisma.reminder.findMany({
      orderBy: { triggerAt: "asc" },
      include: { task: true, habit: true, event: true },
    });
    res.json(reminders);
  })
);

router.get(
  "/pending",
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const reminders = await prisma.reminder.findMany({
      where: { delivered: false, triggerAt: { lte: now } },
      include: { task: true, habit: true, event: true },
    });
    res.json(reminders);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = upsertSchema.parse(req.body);
    const created = await prisma.reminder.create({ data });
    res.status(201).json(created);
  })
);

router.patch(
  "/:id/deliver",
  asyncHandler(async (req, res) => {
    const updated = await prisma.reminder.update({
      where: { id: req.params.id },
      data: { delivered: true },
    });
    res.json(updated);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.reminder.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

export default router;
