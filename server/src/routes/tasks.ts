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
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
  progress: z.number().min(0).max(100).optional(),
  startDate: dateOrNull,
  dueDate: dateOrNull,
  dueTime: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  position: z.number().optional(),
  categoryId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).optional(),
});

const include = {
  category: true,
  tags: { include: { tag: true } },
  reminders: true,
};

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status, categoryId, search } = req.query as Record<string, string | undefined>;
    const tasks = await prisma.task.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(search
          ? { OR: [{ title: { contains: search } }, { description: { contains: search } }] }
          : {}),
      },
      include,
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    });
    res.json(tasks.map(serialize));
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const task = await prisma.task.findUnique({ where: { id: req.params.id }, include });
    if (!task) return res.status(404).json({ error: "NotFound" });
    res.json(serialize(task));
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { tagIds, ...data } = upsertSchema.parse(req.body);
    const created = await prisma.task.create({
      data: {
        ...data,
        tags: tagIds?.length
          ? { create: tagIds.map((tagId) => ({ tag: { connect: { id: tagId } } })) }
          : undefined,
      },
      include,
    });
    res.status(201).json(serialize(created));
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = upsertSchema.partial().parse(req.body);
    const { tagIds, ...data } = parsed;
    const completedAt = data.status === "completed" ? new Date() : data.status ? null : undefined;

    if (tagIds) {
      await prisma.taskTag.deleteMany({ where: { taskId: req.params.id } });
    }

    const updated = await prisma.task.update({
      where: { id: req.params.id },
      data: {
        ...data,
        ...(completedAt !== undefined ? { completedAt } : {}),
        ...(tagIds && tagIds.length
          ? { tags: { create: tagIds.map((tagId) => ({ tag: { connect: { id: tagId } } })) } }
          : {}),
      },
      include,
    });
    res.json(serialize(updated));
  })
);

router.patch(
  "/reorder",
  asyncHandler(async (req, res) => {
    const schema = z.array(z.object({ id: z.string(), position: z.number(), status: z.string().optional() }));
    const items = schema.parse(req.body);
    await prisma.$transaction(
      items.map((it) =>
        prisma.task.update({
          where: { id: it.id },
          data: { position: it.position, ...(it.status ? { status: it.status } : {}) },
        })
      )
    );
    res.json({ ok: true });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.task.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

function serialize(task: any) {
  return {
    ...task,
    tags: task.tags?.map((t: any) => t.tag) ?? [],
  };
}

export default router;
