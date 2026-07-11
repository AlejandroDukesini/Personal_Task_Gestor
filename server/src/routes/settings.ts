import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../db";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

const updateSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  language: z.string().optional(),
  dateFormat: z.string().optional(),
  primaryColor: z.string().optional(),
  fontScale: z.number().optional(),
  appName: z.string().min(1).max(40).optional(),
  appLogo: z.string().max(500000).nullable().optional(),
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

function hashPin(pin: string) {
  return crypto.createHash("sha256").update(pin).digest("hex");
}

router.post(
  "/pin",
  asyncHandler(async (req, res) => {
    const { pin } = z.object({ pin: z.string().min(4).max(32) }).parse(req.body);
    await prisma.settings.update({
      where: { id: 1 },
      data: { pinHash: hashPin(pin), pinEnabled: true },
    });
    res.json({ ok: true });
  })
);

router.post(
  "/pin/verify",
  asyncHandler(async (req, res) => {
    const { pin } = z.object({ pin: z.string() }).parse(req.body);
    const s = await prisma.settings.findUnique({ where: { id: 1 } });
    const ok = !!s?.pinHash && s.pinHash === hashPin(pin);
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
    res.status(204).end();
  })
);

export default router;
