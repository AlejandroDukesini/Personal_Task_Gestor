import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "ValidationError", details: err.flatten() });
  }
  console.error("[error]", err);
  const status = typeof err?.status === "number" ? err.status : 500;
  res.status(status).json({
    error: err?.name ?? "InternalError",
    message: err?.message ?? "Error inesperado",
  });
};
