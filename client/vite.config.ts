import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as { version: string };

/**
 * Tras el build, inyecta en dist/sw.js la lista de todos los ficheros
 * generados (precaché completa = offline completo) y un identificador de
 * build derivado de su contenido: cualquier cambio de código produce un
 * Service Worker distinto, que el navegador detecta como actualización.
 */
function serviceWorkerPrecache(): Plugin {
  let outDir = "dist";
  return {
    name: "gt-sw-precache",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const dist = path.resolve(__dirname, outDir);
      const swPath = path.join(dist, "sw.js");
      if (!fs.existsSync(swPath)) return;
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, f.name);
          if (f.isDirectory()) walk(full);
          else files.push("/" + path.relative(dist, full).split(path.sep).join("/"));
        }
      };
      walk(dist);
      // Fuera: el propio SW, mapas de código, redirecciones y la imagen para
      // redes sociales (pesada e innecesaria offline).
      const precache = files.filter((f) => !/\/(sw\.js|_redirects|robots\.txt|sitemap\.xml|og-image\.png)$|\.map$/.test(f)).sort();
      precache.unshift("/");
      const hash = crypto.createHash("sha256");
      for (const f of precache) if (f !== "/") hash.update(f).update(fs.readFileSync(path.join(dist, f)));
      const buildId = `${pkg.version}-${hash.digest("hex").slice(0, 12)}`;
      const sw = fs
        .readFileSync(swPath, "utf8")
        .replace("__BUILD_ID__", buildId)
        .replace("self.__PRECACHE__ || []", JSON.stringify(precache));
      fs.writeFileSync(swPath, sw);
      fs.writeFileSync(path.join(dist, "version.json"), JSON.stringify({ version: pkg.version, build: buildId }));
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerPrecache()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    // `host: true` publica el dev server en la red local para poder abrirlo
    // desde el móvil. Ojo: sobre http y por IP no hay contexto seguro, así que
    // ni PWA ni notificaciones — para eso, `npm run sync` (sirve por https).
    host: true,
    proxy: { "/api": "http://localhost:4000" },
  },
  preview: {
    port: 4173,
    host: true,
    proxy: { "/api": "http://localhost:4000" },
  },
  build: {
    rollupOptions: {
      output: {
        // Separación manual de vendors: las librerías pesadas viajan en su
        // propio chunk cacheable, independiente del código de la aplicación.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-calendar": [
            "@fullcalendar/core",
            "@fullcalendar/react",
            "@fullcalendar/daygrid",
            "@fullcalendar/timegrid",
            "@fullcalendar/list",
            "@fullcalendar/interaction",
          ],
          "vendor-charts": ["recharts"],
          "vendor-motion": ["framer-motion"],
        },
      },
    },
  },
});
