import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

const upsertSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  type: z.enum(["daily", "weekly", "monthly", "yearly"]).optional(),
  targetValue: z.number().optional(),
  currentValue: z.number().optional(),
  unit: z.string().nullable().optional(),
  startDate: z.string().transform((s) => new Date(s)).optional(),
  endDate: z.string().transform((s) => new Date(s)),
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
    const created = await prisma.goal.create({ data, include: { category: true } });
    res.status(201).json(created);
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = upsertSchema.partial().parse(req.body);
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
