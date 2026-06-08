import { prisma } from "./db";

async function main() {
  await prisma.settings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });

  const existing = await prisma.category.count();
  if (existing > 0) {
    console.log("[seed] Ya existen datos, omito el seed de ejemplo.");
    return;
  }

  console.log("[seed] Creando datos de ejemplo...");

  const personal = await prisma.category.create({
    data: { name: "Personal", color: "#6366f1", icon: "User" },
  });
  const trabajo = await prisma.category.create({
    data: { name: "Trabajo", color: "#f59e0b", icon: "Briefcase" },
  });
  await prisma.category.create({
    data: { name: "Salud", color: "#10b981", icon: "Heart", parentId: personal.id },
  });
  await prisma.category.create({
    data: { name: "Finanzas", color: "#ef4444", icon: "Wallet", parentId: personal.id },
  });

  const urgente = await prisma.tag.create({ data: { name: "Urgente", color: "#ef4444" } });
  const importante = await prisma.tag.create({ data: { name: "Importante", color: "#f59e0b" } });

  await prisma.task.create({
    data: {
      title: "Revisar el plan del mes",
      description: "Planificar objetivos personales y profesionales del mes en curso.",
      priority: "high",
      status: "pending",
      categoryId: personal.id,
      dueDate: new Date(Date.now() + 86400000),
      tags: { create: [{ tag: { connect: { id: importante.id } } }] },
    },
  });
  await prisma.task.create({
    data: {
      title: "Enviar reporte semanal",
      priority: "critical",
      status: "in_progress",
      progress: 60,
      categoryId: trabajo.id,
      dueDate: new Date(Date.now() + 172800000),
      tags: { create: [{ tag: { connect: { id: urgente.id } } }] },
    },
  });
  await prisma.task.create({
    data: {
      title: "Leer 30 min antes de dormir",
      priority: "low",
      status: "pending",
      categoryId: personal.id,
    },
  });

  await prisma.habit.create({
    data: {
      name: "Beber 2L de agua",
      color: "#0ea5e9",
      icon: "Droplet",
      frequency: "daily",
      dailyTarget: 8,
    },
  });
  await prisma.habit.create({
    data: {
      name: "Leer 20 min",
      color: "#8b5cf6",
      icon: "BookOpen",
      frequency: "daily",
    },
  });
  await prisma.habit.create({
    data: {
      name: "Ejercicio",
      color: "#10b981",
      icon: "Dumbbell",
      frequency: "custom",
      daysOfWeek: "1,3,5",
    },
  });

  await prisma.goal.create({
    data: {
      title: "Completar 100 tareas este mes",
      type: "monthly",
      targetValue: 100,
      currentValue: 12,
      unit: "tareas",
      endDate: new Date(Date.now() + 25 * 86400000),
    },
  });

  // Evento ejemplo
  const start = new Date();
  start.setHours(15, 0, 0, 0);
  const end = new Date(start);
  end.setHours(16, 0, 0, 0);
  await prisma.event.create({
    data: {
      title: "Reunión de planificación",
      start,
      end,
      color: "#6366f1",
    },
  });

  console.log("[seed] Listo");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
