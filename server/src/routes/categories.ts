import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { asyncHandler } from "../lib/asyncHandler";
import { RuleError, requiredText, rule } from "../lib/rules";

const router = Router();

const upsertSchema = z.object({
  name: requiredText("El nombre", 80),
  color: z.string().optional(),
  icon: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
});

/** Jerarquía de un solo nivel, como en el formulario y en la API local. */
async function checkParent(parentId: string | null | undefined, selfId?: string) {
  if (!parentId) return;
  rule(parentId !== selfId, "Una categoría no puede ser su propia categoría padre");
  const parent = await prisma.category.findUnique({ where: { id: parentId } });
  if (!parent) throw new RuleError(404, "Categoría padre no encontrada");
  rule(!parent.parentId, "Solo hay un nivel de subcategorías: elige una categoría principal como padre");
  if (selfId) {
    const children = await prisma.category.count({ where: { parentId: selfId } });
    rule(children === 0, "Esta categoría tiene subcategorías: no puede convertirse en subcategoría", 409);
  }
}

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      orderBy: { createdAt: "asc" },
      include: { children: true, _count: { select: { tasks: true, habits: true } } },
    });
    res.json(categories);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = upsertSchema.parse(req.body);
    await checkParent(data.parentId);
    const created = await prisma.category.create({ data });
    res.status(201).json(created);
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = upsertSchema.partial().parse(req.body);
    await checkParent(data.parentId, req.params.id);
    const updated = await prisma.category.update({ where: { id: req.params.id }, data });
    res.json(updated);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.category.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

export default router;
