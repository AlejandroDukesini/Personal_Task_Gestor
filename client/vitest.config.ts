import { defineConfig } from "vitest/config";
import path from "node:path";

// Zona fija: las pruebas de fechas y horarios no dependen de la máquina.
process.env.TZ = "America/Bogota";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
