/* eslint-env serviceworker */
/**
 * Service Worker de "Plan Gestor Task".
 *
 * Offline completo: en el build se inyecta la lista de TODOS los ficheros
 * generados (`__PRECACHE__`), así la app abre sin conexión incluso en
 * secciones que nunca se visitaron (sus fragmentos ya están en caché).
 *
 * Actualizaciones controladas: una versión nueva se instala en segundo plano
 * y ESPERA. La app muestra «Nueva versión disponible» y solo al aceptar se
 * activa (mensaje SKIP_WAITING) y se recarga. Nunca cambia el código bajo los
 * pies del usuario a mitad de una tarea.
 *
 * Los datos NO pasan por aquí: viven en IndexedDB, separados del código.
 * Actualizar la app no toca los datos; las migraciones de datos las hace la
 * propia app al arrancar (con punto de restauración previo).
 */

const VERSION = "__BUILD_ID__";
const PRECACHE = self.__PRECACHE__ || [];
const APP_CACHE = `gt-app-${VERSION}`;
const RUNTIME_CACHE = "gt-runtime";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then(async (cache) => {
      // Uno a uno: un fichero ausente no debe impedir la instalación.
      await Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" }))));
    })
  );
  // Sin skipWaiting aquí: la activación la decide el usuario.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("gt-") && k !== APP_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
  if (event.data === "VERSION") event.source?.postMessage({ type: "VERSION", version: VERSION });
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Fuentes de Google: caché en tiempo de ejecución para verse igual offline.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (c) => {
        const hit = await c.match(request);
        if (hit) return hit;
        try {
          const res = await fetch(request);
          if (res.ok || res.type === "opaque") c.put(request, res.clone());
          return res;
        } catch {
          return hit ?? Response.error();
        }
      })
    );
    return;
  }

  // Resto de orígenes (p. ej. el WebSocket o el servicio del PC): sin tocar.
  if (url.origin !== self.location.origin) return;
  // Endpoints del servicio local del PC: siempre a la red.
  if (url.pathname === "/pair" || url.pathname === "/qr.png" || url.pathname === "/ca.crt" || url.pathname === "/health") return;

  if (request.mode === "navigate") {
    // Shell de la SPA desde la caché de ESTA versión: abre al instante y sin
    // red. El HTML nuevo llega con la versión nueva del Service Worker.
    event.respondWith(
      caches.open(APP_CACHE).then(async (c) => (await c.match("/index.html")) ?? fetch(request).catch(() => Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          if (res.ok && url.pathname.startsWith("/assets/")) {
            const copy = res.clone();
            caches.open(APP_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
    )
  );
});

/* --------------------------------------------------------- notificaciones */

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          return client.navigate(target).catch(() => undefined);
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
