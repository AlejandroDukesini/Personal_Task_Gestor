import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./db";
import { errorHandler } from "./middleware/error";
import { corsOptions, rateLimit, securityHeaders } from "./middleware/security";
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

// Escucha solo en loopback salvo que se pida lo contrario de forma explícita.
// Antes, `app.listen(PORT)` publicaba la base de datos -- sin autenticación --
// a toda la red local (wifi de una cafetería, red de oficina).
const HOST = process.env.HOST || "127.0.0.1";

// La API va detrás de un proxy solo si se declara: confiar siempre en
// X-Forwarded-For permitiría falsear la IP y esquivar el rate limiting.
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(securityHeaders);
app.use(cors(corsOptions));

// Límite de cuerpo: 20 MB permitía agotar memoria con una sola petición.
// 6 MB cubre el caso real más grande (importar un backup con logo embebido).
app.use(express.json({ limit: "6mb" }));

// Límite global: absorbe escaneos y bucles descontrolados del cliente.
app.use("/api", rateLimit({ windowMs: 60_000, max: 600, name: "global" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, version: "1.0.0" });
});

// Fuerza bruta contra el PIN: 10 intentos cada 15 minutos por IP.
app.use(
  "/api/settings/pin/verify",
  rateLimit({ windowMs: 15 * 60_000, max: 10, name: "pin-verify" })
);
// Escrituras masivas de backup: caras en CPU y disco.
app.use("/api/backup/import", rateLimit({ windowMs: 60_000, max: 5, name: "backup-import" }));

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
  app.listen(PORT, HOST, () => {
    console.log(`[server] escuchando en http://${HOST}:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("[server] error al iniciar", err);
  process.exit(1);
});
