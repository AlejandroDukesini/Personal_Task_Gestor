// Controles de seguridad del servidor Express.
//
// Se implementan a mano, sin helmet ni express-rate-limit, para no añadir
// dependencias (y superficie de suministro) a un servicio que solo se ejecuta
// en local. La cobertura es equivalente para este caso de uso.

import type { CorsOptions } from "cors";
import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Orígenes permitidos. Por defecto, solo los puertos de Vite (dev y preview)
 * en loopback. Ampliable con CORS_ORIGINS="https://a.dev,https://b.dev".
 *
 * Motivo: `cors()` sin argumentos responde `Access-Control-Allow-Origin: *`.
 * Con el servidor levantado, cualquier web abierta en el navegador podía leer
 * http://localhost:4000/api/backup/export y exfiltrar todas las tareas,
 * hábitos y notas del usuario. La lista blanca cierra esa vía.
 */
const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

export function allowedOrigins(): string[] {
  const extra = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...DEFAULT_ORIGINS, ...extra];
}

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Sin cabecera Origin => no es una petición cross-origin de navegador
    // (curl, health checks, el propio front servido por Vite). Se permite.
    if (!origin) return callback(null, true);
    if (allowedOrigins().includes(origin)) return callback(null, true);
    return callback(new Error("Origen no permitido por CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  // La API no usa cookies ni cabecera Authorization: no hay credenciales que
  // compartir, y mantenerlo en false evita habilitar CSRF por descuido.
  credentials: false,
  maxAge: 600,
};

/**
 * Cabeceras de seguridad equivalentes a las que aplicaría helmet.
 * La API solo devuelve JSON, así que la CSP puede ser máximamente restrictiva.
 */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()");
  // Respuestas con datos personales: fuera de cachés intermedias.
  res.setHeader("Cache-Control", "no-store");
  // No revelar el motor: reduce el fingerprinting previo a un exploit.
  res.removeHeader("X-Powered-By");
  next();
};

/**
 * Limitador de peticiones en memoria (ventana deslizante por IP).
 * Suficiente para un proceso único; si algún día el servidor se despliega
 * replicado, hay que sustituirlo por un contador compartido (Redis).
 */
interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

// Purga periódica para que el Map no crezca sin límite (DoS por memoria).
const PURGE_INTERVAL_MS = 60_000;
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => t > cutoff);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}, PURGE_INTERVAL_MS).unref();

export function rateLimit(options: { windowMs: number; max: number; name: string }): RequestHandler {
  const { windowMs, max, name } = options;
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${name}:${req.ip ?? "unknown"}`;
    const now = Date.now();
    const bucket = buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

    if (bucket.hits.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - bucket.hits[0])) / 1000);
      buckets.set(key, bucket);
      // Evidencia para el Blue Team: un pico de estas líneas es la señal de
      // fuerza bruta o de un escaneo automatizado contra la API.
      console.warn(
        `[security] rate-limit ${name} ip=${req.ip} path=${req.path} retryAfter=${retryAfter}s`
      );
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "TooManyRequests", message: "Demasiadas peticiones." });
    }

    bucket.hits.push(now);
    buckets.set(key, bucket);
    next();
  };
}
