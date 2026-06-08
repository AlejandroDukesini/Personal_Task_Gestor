import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

const upsertSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  icon: z.string().nullable().optional(),
});

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const tags = await prisma.tag.findMany({ orderBy: { name: "asc" } });
    res.json(tags);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = upsertSchema.parse(req.body);
    const created = await prisma.tag.create({ data });
    res.status(201).json(created);
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = upsertSchema.partial().parse(req.body);
    const updated = await prisma.tag.update({ where: { id: req.params.id }, data });
    res.json(updated);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.tag.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

export default router;
