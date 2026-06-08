import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

const upsertSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  start: z.string().transform((s) => new Date(s)),
  end: z.string().transform((s) => new Date(s)),
  allDay: z.boolean().optional(),
  color: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as Record<string, string | undefined>;
    const events = await prisma.event.findMany({
      where: {
        ...(from || to
          ? {
              start: { gte: from ? new Date(from) : undefined },
              end: { lte: to ? new Date(to) : undefined },
            }
          : {}),
      },
      include: { category: true },
      orderBy: { start: "asc" },
    });
    res.json(events);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = upsertSchema.parse(req.body);
    const created = await prisma.event.create({ data, include: { category: true } });
    res.status(201).json(created);
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = upsertSchema.partial().parse(req.body);
    const updated = await prisma.event.update({
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
    await prisma.event.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

export default router;
