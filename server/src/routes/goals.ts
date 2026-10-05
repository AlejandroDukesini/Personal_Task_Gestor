import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { asyncHandler } from "../lib/asyncHandler";
import { MESSAGES, RuleError, dateField, dayOf, merged, requiredText, rule, touches } from "../lib/rules";

const router = Router();

const upsertSchema = z.object({
  title: requiredText("El título", 200),
  description: z.string().nullable().optional(),
  type: z.enum(["daily", "weekly", "monthly", "yearly"]).optional(),
  targetValue: z.number().finite().positive(MESSAGES.goalTarget).optional(),
  currentValue: z.number().finite().optional(),
  unit: z.string().nullable().optional(),
  startDate: dateField("Inicio").optional(),
  endDate: dateField("Fecha límite"),
  categoryId: z.string().nullable().optional(),
  completed: z.boolean().optional(),
});

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const goals = await prisma.goal.findMany({
      orderBy: { endDate: "asc" },
      include: { category: true },
    });
    res.json(goals);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = upsertSchema.parse(req.body);
    const today = dayOf(new Date());
    rule(dayOf(data.endDate) >= dayOf(data.startDate ?? new Date(today)), MESSAGES.goalDates);
    rule(dayOf(data.endDate) >= today, MESSAGES.goalPastDeadline);
    const created = await prisma.goal.create({ data, include: { category: true } });
    res.status(201).json(created);
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = upsertSchema.partial().parse(req.body);
    const current = await prisma.goal.findUnique({ where: { id: req.params.id } });
    if (!current) throw new RuleError(404, "Objetivo no encontrado");
    if (touches(data, ["startDate", "endDate"])) {
      const next = merged(current, data);
      rule(dayOf(next.endDate) >= dayOf(next.startDate), MESSAGES.goalDates);
    }
    const updated = await prisma.goal.update({
      where: { id: req.params.id },
      data,
      include: { category: true },
    });
    res.json(updated);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.goal.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

export default router;
