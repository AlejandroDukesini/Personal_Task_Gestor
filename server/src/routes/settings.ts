import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../db";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

/**
 * El logo se guarda embebido como data URL. Solo se admite imagen rasterizada
 * en base64: bloquea `data:text/html` y `data:image/svg+xml`, que son
 * contenido activo si algún consumidor los renderiza fuera de un `<img>`.
 */
const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

const updateSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  language: z.string().max(16).optional(),
  dateFormat: z.string().max(32).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "Color inválido").optional(),
  fontScale: z.number().min(0.5).max(2).optional(),
  appName: z.string().min(1).max(40).optional(),
  appLogo: z
    .string()
    .max(500000)
    .refine((v) => v === "" || LOGO_DATA_URL.test(v) || !v.startsWith("data:"), {
      message: "Formato de logo no permitido",
    })
    .nullable()
    .optional(),
  userName: z.string().max(40).nullable().optional(),
  timezone: z.string().max(64).optional(),
});

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
    const { pinHash, ...safe } = settings;
    res.json({ ...safe, pinSet: Boolean(pinHash) });
  })
);

router.put(
  "/",
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const updated = await prisma.settings.update({ where: { id: 1 }, data });
    const { pinHash, ...safe } = updated;
    res.json({ ...safe, pinSet: Boolean(pinHash) });
  })
);

// --------------------------------------------------------------------- PIN
//
// SHA-256 a una sola ronda y sin sal permite romper un PIN de 4 dígitos
// probando las 10.000 combinaciones de forma instantánea si el hash se filtra
// (backup, copia del dev.db). PBKDF2 con sal aleatoria encarece ese ataque.
// El formato coincide con el del cliente local-first para que los datos sean
// intercambiables entre ambas implementaciones.

const PBKDF2_ITERATIONS = 210000; // Guía OWASP para PBKDF2-SHA256.
const PBKDF2_PREFIX = "pbkdf2$sha256$";

function derive(pin: string, salt: Buffer, iterations: number): string {
  return crypto.pbkdf2Sync(pin, salt, iterations, 32, "sha256").toString("hex");
}

function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16);
  return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}$${salt.toString("hex")}$${derive(
    pin,
    salt,
    PBKDF2_ITERATIONS
  )}`;
}

/** Comparación en tiempo constante: no filtra el prefijo correcto. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Acepta el formato nuevo y el heredado; indica si procede re-sellar. */
function verifyPin(pin: string, stored: string | null): { ok: boolean; upgrade?: string } {
  if (!stored) return { ok: false };

  if (stored.startsWith(PBKDF2_PREFIX)) {
    const [, , iterStr, saltHex, expected] = stored.split("$");
    const iterations = Number(iterStr);
    if (!Number.isFinite(iterations) || !saltHex || !expected) return { ok: false };
    return { ok: safeEqual(derive(pin, Buffer.from(saltHex, "hex"), iterations), expected) };
  }

  const legacy = crypto.createHash("sha256").update(pin).digest("hex");
  const ok = safeEqual(legacy, stored);
  return ok ? { ok, upgrade: hashPin(pin) } : { ok };
}

router.post(
  "/pin",
  asyncHandler(async (req, res) => {
    const { pin } = z.object({ pin: z.string().min(4).max(32) }).parse(req.body);
    await prisma.settings.update({
      where: { id: 1 },
      data: { pinHash: hashPin(pin), pinEnabled: true },
    });
    console.info("[audit] pin-actualizado");
    res.json({ ok: true });
  })
);

router.post(
  "/pin/verify",
  asyncHandler(async (req, res) => {
    const { pin } = z.object({ pin: z.string().max(128) }).parse(req.body);
    const s = await prisma.settings.findUnique({ where: { id: 1 } });
    const { ok, upgrade } = verifyPin(pin, s?.pinHash ?? null);

    // Migración transparente del hash heredado tras un acierto.
    if (ok && upgrade) {
      await prisma.settings.update({ where: { id: 1 }, data: { pinHash: upgrade } });
    }

    // Evidencia para detección: los fallos repetidos son la señal de fuerza
    // bruta contra la pantalla de bloqueo.
    if (!ok) console.warn(`[security] pin-fallido ip=${req.ip}`);

    res.json({ ok });
  })
);

router.delete(
  "/pin",
  asyncHandler(async (_req, res) => {
    await prisma.settings.update({
      where: { id: 1 },
      data: { pinHash: null, pinEnabled: false },
    });
    console.info("[audit] pin-eliminado");
    res.status(204).end();
  })
);

export default router;
