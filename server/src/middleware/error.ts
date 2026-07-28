import crypto from "node:crypto";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "ValidationError", details: err.flatten() });
  }

  // Origen rechazado por la lista blanca de CORS: es una decisión de política,
  // no un fallo del servidor, y conviene registrarlo como intento de acceso.
  if (err?.message === "Origen no permitido por CORS") {
    console.warn(`[security] cors-bloqueado origin=${req.headers.origin} path=${req.path}`);
    return res.status(403).json({ error: "Forbidden", message: "Origen no permitido." });
  }

  const status = typeof err?.status === "number" ? err.status : 500;

  // Los 4xx los genera la propia aplicación con mensajes pensados para el
  // usuario ("No encontrado", "Ya existe una etiqueta..."): son seguros.
  if (status < 500) {
    return res.status(status).json({
      error: err?.name ?? "RequestError",
      message: err?.message ?? "Solicitud inválida",
    });
  }

  // Los 5xx pueden arrastrar rutas del sistema, SQL o internos de Prisma.
  // Se registra el detalle en el servidor y al cliente solo viaja un
  // identificador con el que correlacionar el incidente en los logs.
  const incidentId = crypto.randomUUID();
  console.error(`[error] id=${incidentId} method=${req.method} path=${req.path}`, err);
  res.status(500).json({
    error: "InternalError",
    message: "Error inesperado.",
    incidentId,
  });
};
