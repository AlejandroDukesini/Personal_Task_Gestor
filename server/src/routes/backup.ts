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
    // El backup es un fichero que el usuario puede haber recibido de terceros:
    // entrada no confiable. Se acota el número de filas (una importación sin
    // límite bloquea el proceso escribiendo en SQLite) y se exige `id` de
    // texto en cada fila en lugar de aceptar `any`.
    const MAX_ROWS = 20000;
    const row = z.object({ id: z.string().min(1).max(128) }).passthrough();
    const rows = z.array(row).max(MAX_ROWS).optional();

    const schema = z.object({
      data: z.object({
        categories: rows,
        tags: rows,
        tasks: rows,
        taskTags: z
          .array(z.object({ taskId: z.string().min(1).max(128), tagId: z.string().min(1).max(128) }))
          .max(MAX_ROWS)
          .optional(),
        habits: rows,
        habitLogs: rows,
        events: rows,
        goals: rows,
        reminders: rows,
        // Presente por compatibilidad del formato, nunca se aplica: importar
        // ajustes ajenos permitiría sustituir el hash del PIN por uno conocido.
        settings: z.any().optional(),
      }),
      replace: z.boolean().optional(),
    });
    const { data, replace } = schema.parse(req.body);

    console.info(`[audit] backup-import replace=${Boolean(replace)} ip=${req.ip}`);

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

    // El esquema zod garantiza la forma mínima (`id` de texto); Prisma valida
    // el resto de columnas en tiempo de ejecución y rechaza las desconocidas.
    // El cast solo desactiva la comprobación estática, no una validación.
    const asRow = (r: unknown) => r as any;

    // Inserción en orden
    for (const c of data.categories ?? [])
      await prisma.category.upsert({ where: { id: c.id }, create: asRow(c), update: asRow(c) });
    for (const t of data.tags ?? [])
      await prisma.tag.upsert({ where: { id: t.id }, create: asRow(t), update: asRow(t) });
    for (const t of data.tasks ?? []) {
      const { tags: _tags, ...rest } = t;
      await prisma.task.upsert({
        where: { id: rest.id },
        create: asRow(rest),
        update: asRow(rest),
      });
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
    for (const h of data.habits ?? [])
      await prisma.habit.upsert({ where: { id: h.id }, create: asRow(h), update: asRow(h) });
    for (const l of data.habitLogs ?? [])
      await prisma.habitLog.upsert({ where: { id: l.id }, create: asRow(l), update: asRow(l) });
    for (const e of data.events ?? [])
      await prisma.event.upsert({ where: { id: e.id }, create: asRow(e), update: asRow(e) });
    for (const r of data.reminders ?? [])
      await prisma.reminder.upsert({ where: { id: r.id }, create: asRow(r), update: asRow(r) });
    for (const g of data.goals ?? [])
      await prisma.goal.upsert({ where: { id: g.id }, create: asRow(g), update: asRow(g) });

    res.json({ ok: true });
  })
);

export default router;
