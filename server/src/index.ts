import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./db";
import { errorHandler } from "./middleware/error";
import categoriesRouter from "./routes/categories";
import tasksRouter from "./routes/tasks";
import tagsRouter from "./routes/tags";
import habitsRouter from "./routes/habits";
import eventsRouter from "./routes/events";
import remindersRouter from "./routes/reminders";
import goalsRouter from "./routes/goals";
import settingsRouter from "./routes/settings";
import statsRouter from "./routes/stats";
import backupRouter from "./routes/backup";

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, version: "1.0.0" });
});

app.use("/api/categories", categoriesRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/tags", tagsRouter);
app.use("/api/habits", habitsRouter);
app.use("/api/events", eventsRouter);
app.use("/api/reminders", remindersRouter);
app.use("/api/goals", goalsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/stats", statsRouter);
app.use("/api/backup", backupRouter);

app.use(errorHandler);

async function bootstrap() {
  // Asegura settings por defecto
  await prisma.settings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
  app.listen(PORT, () => {
    console.log(`[server] escuchando en http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("[server] error al iniciar", err);
  process.exit(1);
});
