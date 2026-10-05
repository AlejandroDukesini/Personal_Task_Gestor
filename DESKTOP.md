# Versión de escritorio (Windows) — Tauri 2

La app de escritorio es **la misma app React** (`client/`) dentro de una ventana
nativa de Windows (WebView2) gracias a [Tauri 2](https://tauri.app). No hay un
servidor local ni un frontend aparte: el build de Vite (`client/dist`) va dentro
del ejecutable.

| Dato | Valor |
|---|---|
| Nombre | Plan Gestor Task |
| Identificador | `com.alejandrodukesini.gestortareas` (**no cambiar nunca**, ver «Datos») |
| Versión | la de `client/package.json` (hoy 1.2.1); `src-tauri/Cargo.toml` debe coincidir |
| Instalador | NSIS (`.exe`), por usuario (sin permisos de administrador), x64 |

## Requisitos para compilar (solo en el equipo de desarrollo)

1. **Node.js** 20+ y `npm install` en la raíz del repositorio.
2. **Rust** estable, toolchain `stable-x86_64-pc-windows-msvc` (instalar con
   [rustup](https://rustup.rs)).
3. **Visual Studio Build Tools 2022** con la carga «Desarrollo de escritorio con
   C++» (MSVC + Windows SDK). Ocupa ~6–7 GB.
4. **WebView2** (ya viene con Windows 10/11 actualizados).
5. Espacio libre: además de lo anterior, la compilación de Rust
   (`client/src-tauri/target`) ocupa ~2–3 GB.

`npx tauri info` (desde `client/`) comprueba que todo esté en su sitio.

## Comandos

```bash
npm run desktop:dev     # ventana de escritorio con recarga en caliente (Vite en :5173)
npm run desktop:build   # build de producción + instalador NSIS
```

(Equivalen a `npm run tauri:dev` / `npm run tauri:build` dentro de `client/`.)
El flujo web de siempre (`npm run dev`, `npm run build`, Netlify) no cambia.

### Dónde queda el instalador

```
client/src-tauri/target/release/bundle/nsis/Plan Gestor Task_<versión>_x64-setup.exe
```

Es un **instalador**, no un ejecutable portátil: se copia a otro equipo con
Windows 10/11 x64 y se ejecuta; no necesita Node, Rust ni el repositorio. Si
el equipo no tuviera WebView2, el instalador descarga su instalador oficial
(eso sí requiere internet una vez; en Windows 11 ya viene incluido).

## Datos del usuario

- Se guardan igual que en la web: **IndexedDB** (principal) + espejo en
  `localStorage` + puntos de restauración, gestionados por
  `client/src/services/storage.ts`. No se ha cambiado el formato.
- En escritorio viven en el perfil privado de WebView2 de la app:
  `%LOCALAPPDATA%\com.alejandrodukesini.gestortareas\EBWebView\`.
- **El identificador de la app y el esquema de origen (`useHttpsScheme: false`
  → `http://tauri.localhost`) no deben cambiar nunca.** Los datos de IndexedDB
  van ligados a ese origen y a esa carpeta: si cambian, la app arrancaría con
  una base vacía (los datos seguirían en disco, pero no los vería).
- **Pasar los datos de la web al escritorio:** son orígenes distintos, así que
  no se comparten solos. En la web: Configuración › Copias de seguridad ›
  descargar copia. En el escritorio: restaurar esa copia con el asistente. Los
  datos de la web no se tocan.
- Recomendación: exportar copias de seguridad periódicamente. La persistencia
  local depende del disco del equipo; no protege frente a fallos del disco,
  borrado de la carpeta de datos o pérdida del equipo.

### Actualizar

Ejecutar el instalador de la versión nueva sobre la instalada. Reemplaza los
archivos del programa y **conserva** la carpeta de datos (mismo identificador).
Antes de actualizar conviene descargar una copia de seguridad.

### Desinstalar

Desde «Aplicaciones instaladas» de Windows. El desinstalador NSIS ofrece una
casilla para **borrar también los datos de la app**; si no se marca, la carpeta
`%LOCALAPPDATA%\com.alejandrodukesini.gestortareas` se conserva y una
reinstalación posterior vuelve a ver los datos.

## Funcionamiento sin conexión

| Función | Offline | Notas |
|---|---|---|
| Tareas, hábitos, calendario, objetivos, notas, finanzas, estadísticas | Sí | Todo es local (IndexedDB). |
| Copias de seguridad / restauración / importaciones de archivos | Sí | Las descargas van a la carpeta Descargas de Windows. |
| Recordatorios (notificaciones) | Sí | Notificaciones nativas de Windows (plugin `notification`); solo con la app abierta, igual que en la web. Se activan/desactivan en Configuración › Sistema › Notificaciones de Windows. |
| Fuente Inter | Sí | Incluida con `@fontsource/inter` (antes Google Fonts). |
| Importar hábitos desde una captura (OCR) | Sí | Motor y datos de idioma incluidos (ver abajo). |
| Google Calendar | **No disponible en escritorio** | Ver «Google Calendar». Sigue disponible en la web. |
| Sincronización manual con el móvil | Requiere red local | Depende del servicio `sync/` (Node). En escritorio, el modo «este PC escucha» no se activa porque la app no la sirve ese servicio; el resto de la app no se ve afectado. |

### OCR incluido

`vite.config.ts` (`localOcrAssets`) copia a `dist/ocr/` (≈ 16,9 MB sin
comprimir) y en desarrollo sirve desde `node_modules`:

| Archivo | Tamaño | Origen | Licencia |
|---|---|---|---|
| `ocr/worker.min.js` | 0,1 MB | `tesseract.js` 7.0.0 | Apache-2.0 |
| `ocr/core/tesseract-core-{,simd-,relaxedsimd-}lstm.wasm.js` | 3 × 3,9 MB | `tesseract.js-core` 7.0.0 | Apache-2.0 |
| `ocr/lang/spa.traineddata.gz` | 2,1 MB | `@tesseract.js-data/spa` 1.0.0 (`4.0.0_best_int`) | paquete MIT; modelo de tessdata, Apache-2.0 |
| `ocr/lang/eng.traineddata.gz` | 3,0 MB | `@tesseract.js-data/eng` 1.0.0 (`4.0.0_best_int`) | paquete MIT; modelo de tessdata, Apache-2.0 |

Son los mismos archivos que antes se descargaban de jsDelivr. Se incluyen los
tres núcleos porque el worker elige uno según el soporte SIMD del equipo. En la
web quedan fuera de la precaché del Service Worker (se descargan solo si se usa
el OCR). Al actualizar `tesseract.js`, actualizar también `tesseract.js-core`
a la misma versión.

## Seguridad

- **Capacidades** (`src-tauri/capabilities/default.json`):

  | Permiso | Para qué |
  |---|---|
  | `core:default` | Núcleo de Tauri (ventana, eventos). |
  | `opener:allow-open-url` (solo `http(s)://` y `mailto:`) | Abrir enlaces externos en el navegador del sistema. |
  | `notification:allow-notify` | Mostrar los recordatorios. La WebView2 de Tauri deniega la Notification API del navegador (`requestPermission()` → `denied`), por eso `lib/notifications.ts` usa el plugin en escritorio. |

  Sin acceso al sistema de archivos, sin `shell` y sin comandos nativos propios.
- **CSP** (`src-tauri/tauri.conf.json`): solo recursos de la propia app;
  `wasm-unsafe-eval` para el WebAssembly del OCR; `style-src 'unsafe-inline'`
  por framer-motion/recharts/FullCalendar (igual que en la web). `devCsp`
  añade solo lo que necesita Vite en desarrollo (HMR y su script inline).
- `dragDropEnabled: false`: deja el arrastrar y soltar HTML5 (adjuntos, etc.)
  en manos de la página, como en el navegador.
- Enlaces externos: `client/src/lib/desktop.ts` los abre en el navegador del
  sistema en lugar de dentro de la ventana.
- No hay secretos en el código.

## Google Calendar (fase posterior)

En escritorio la tarjeta de Configuración muestra «No disponible en
escritorio», no arranca la sincronización automática y el formulario de hábito
lo indica. El código de `services/gcal` no se ha tocado, y la opción
«Sincronizar con Google Calendar» de cada hábito se conserva.

Motivo: el flujo actual (Google Identity Services, modelo de token del
navegador) exige un origen web autorizado, y Google no acepta
`http://tauri.localhost`. Integración posible más adelante:

1. Crear en Google Cloud un cliente OAuth de tipo **«App de escritorio»**.
2. Flujo de autorización con **PKCE + redirección loopback**
   (`http://127.0.0.1:<puerto>`): un comando Rust abre el navegador del
   sistema (`opener`), escucha la redirección en un puerto local efímero e
   intercambia el código por tokens.
3. Guardar el refresh token en el **Administrador de credenciales de Windows**
   (crate `keyring`), nunca en IndexedDB/localStorage.
4. Reutilizar `services/gcal/client.ts` y `sync.ts` pasando el token obtenido;
   solo cambia `auth.ts` en escritorio.
5. Añadir `https://www.googleapis.com` a `connect-src` de la CSP de escritorio.

## Pruebas realizadas (1.2.1, 2026-10-04, Windows 11 x64, WebView2 154)

Sobre el instalador NSIS instalado (no sobre `tauri dev`), automatizadas con el
protocolo de depuración de WebView2:

| Prueba | Resultado |
|---|---|
| Instalación silenciosa por usuario, accesos directos de escritorio y menú Inicio | OK |
| Arranque y recarga con la red emulada como **sin conexión** | OK |
| Las 12 rutas (`/`, `/tareas` … `/configuracion`) sin errores | OK |
| Inter cargada en local (400/500/600/700); sin Service Worker; versión v1.2.1 visible | OK |
| Crear, editar, buscar y eliminar tareas (con el `confirm()` nativo) | OK |
| Guardado en IndexedDB y en el espejo de `localStorage` | OK |
| Datos conservados al cerrar a la fuerza y reabrir | OK |
| Datos conservados al instalar encima (actualización de la misma versión) | OK |
| Descarga de copia de seguridad (llega a Descargas) | OK |
| Notificación de prueba (registrada por Windows con el identificador de la app) | OK |
| Enlace externo → navegador del sistema (`plugin:opener`), la app no navega | OK |
| OCR de una captura sin conexión (detectó los 3 eventos de prueba) y 2 min estable después | OK |
| Ninguna petición a internet en todas las pruebas | OK |
| Google Calendar muestra «No disponible en escritorio» | OK |
| Desinstalación: quita programa, entrada y accesos; conserva los datos | OK |

No probado: la casilla «borrar datos» del desinstalador (solo con interfaz),
la instalación en un equipo sin WebView2, la vista previa de adjuntos
(`window.open` de un `blob:`) y una actualización a un número de versión mayor.

Nota para pruebas automatizadas: si la app se lanza desde una terminal
gestionada por otra herramienta, puede quedar dentro de su *Job Object* y
cerrarse cuando esa herramienta termina. No ocurre al abrirla desde el menú Inicio.
