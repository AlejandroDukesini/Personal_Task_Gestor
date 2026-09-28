/// <reference types="vite/client" />
// Aporta el tipado de `import.meta.env` (usado en `lib/pwa.ts` para registrar
// el Service Worker solo en producción).

/** Versión de la app (package.json), inyectada por Vite. */
declare const __APP_VERSION__: string;
