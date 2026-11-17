import { describe, expect, it } from "vitest";
import { open, seal } from "./crypto";

describe("cifrado de copias de seguridad", () => {
  it("contraseña incorrecta o archivo alterado: error claro, nunca datos parciales", async () => {
    const env = await seal({ secreto: 42 }, "correcta", "backup");
    await expect(open(env, "incorrecta")).rejects.toThrow(/contraseña/);
    const tampered = { ...env, data: env.data.slice(0, -4) + (env.data.endsWith("AAAA") ? "BBBB" : "AAAA") };
    await expect(open(tampered, "correcta")).rejects.toThrow();
    // Cambiar el tipo de contenido rompe la autenticación.
    await expect(open({ ...env, content: "offer" }, "correcta")).rejects.toThrow();
    expect(await open(env, "correcta")).toEqual({ secreto: 42 });
    expect(JSON.stringify(env)).not.toContain("secreto");
  });
});
