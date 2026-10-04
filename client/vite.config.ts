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
      // Fuera: el propio SW, mapas de código, redirecciones, la imagen para
      // redes sociales (pesada e innecesaria offline) y el motor de OCR (~17 MB:
      // se descarga solo si se usa y lo guarda el propio tesseract.js).
      const precache = files.filter((f) => !/\/(sw\.js|_redirects|robots\.txt|sitemap\.xml|og-image\.png)$|\.map$|^\/ocr\//.test(f)).sort();
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

/**
 * Motor de OCR servido desde la propia app (en `/ocr/…`), sin CDN: el worker
 * de tesseract.js, los núcleos WebAssembly solo-LSTM (la app usa `oem 1`; el
 * worker elige uno según el soporte SIMD del equipo) y los datos de idioma
 * `spa`/`eng` (`4.0.0_best_int`, los mismos que servía jsDelivr). En
 * desarrollo se sirven desde node_modules; en el build se copian a `dist`.
 */
function localOcrAssets(): Plugin {
  const modules = path.resolve(__dirname, "../node_modules");
  const assets: Record<string, string> = {
    "ocr/worker.min.js": "tesseract.js/dist/worker.min.js",
    "ocr/core/tesseract-core-lstm.wasm.js": "tesseract.js-core/tesseract-core-lstm.wasm.js",
    "ocr/core/tesseract-core-simd-lstm.wasm.js": "tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
    "ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js": "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
    "ocr/lang/spa.traineddata.gz": "@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz",
    "ocr/lang/eng.traineddata.gz": "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  };
  const source = (file: string) => path.join(modules, assets[file]);
  return {
    name: "gt-local-ocr",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = req.url?.split("?")[0].replace(/^\//, "") ?? "";
        if (!(file in assets)) return next();
        // Se sirven tal cual: el .gz lo descomprime tesseract.js, no el navegador.
        res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        fs.createReadStream(source(file)).pipe(res);
      });
    },
    generateBundle() {
      for (const file of Object.keys(assets)) {
        this.emitFile({ type: "asset", fileName: file, source: fs.readFileSync(source(file)) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), localOcrAssets(), serviceWorkerPrecache()],
  // Tauri: no borrar la consola (se ven sus errores de Rust) y exponer sus
  // variables TAURI_ENV_* además de las VITE_* que ya usa la app.
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_"],
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
