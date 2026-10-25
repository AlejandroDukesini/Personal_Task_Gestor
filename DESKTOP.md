# Versión de escritorio (Windows) — Tauri 2

Guía para **desarrollar, compilar y publicar** la app de escritorio. Para
instalarla como usuario: [`INSTALL.md`](INSTALL.md).

La app de escritorio es **la misma app React** (`client/`) dentro de una ventana
nativa de Windows (WebView2) gracias a [Tauri 2](https://tauri.app). No hay un
servidor local ni un frontend aparte: el build de Vite (`client/dist`) va dentro
del ejecutable.

| Dato | Valor |
|---|---|
| Nombre | Plan Gestor Task |
| Identificador | `com.alejandrodukesini.gestortareas` (**no cambiar nunca**, ver «Datos») |
| Versión | la de `client/package.json` (`tauri.conf.json` la lee de ahí); `npm run version:check` comprueba que el resto coincide |
| Instaladores | NSIS (`.exe`), por usuario (sin permisos de administrador), x64: online y offline |

## Requisitos para compilar (solo en el equipo de desarrollo)

1. **Node.js 24 LTS** (la versión de `.nvmrc`, la misma que usan CI y Netlify)
   y `npm ci` en la raíz del repositorio. `npm ci` instala exactamente lo que
   fija `package-lock.json`; el `.npmrc` del proyecto usa el registro público
   de npm para que el lock sea igual en cualquier equipo.
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
npm run desktop:dev            # ventana de escritorio con recarga en caliente (Vite en :5173)
npm run desktop:build          # build de producción + instalador NSIS online
npm run desktop:build:offline  # ídem, con WebView2 incluido (instalador offline)
```

(Equivalen a `npm run tauri:dev` / `tauri:build` / `tauri:build:offline` dentro
de `client/`. La variante offline solo añade `src-tauri/tauri.offline.conf.json`,
que Tauri fusiona sobre `tauri.conf.json`.)
El flujo web de siempre (`npm run dev`, `npm run build`, Netlify) no cambia.

### Dónde queda el instalador

```
client/src-tauri/target/release/bundle/nsis/Plan Gestor Task_<versión>_x64-setup.exe
```

Las dos variantes generan **el mismo nombre de archivo**: renombra el primero
antes de compilar el segundo (CI los renombra a
`PlanGestorTask_<versión>_x64-setup.exe` y `…_x64-offline-setup.exe`).

| Variante | `webviewInstallMode` | Tamaño (1.4.0) | Si falta WebView2 |
|---|---|---|---|
| Online | `downloadBootstrapper` | 11,5 MiB | Lo descarga de Microsoft (requiere Internet) |
| Offline | `offlineInstaller` | 219 MiB | Lo instala desde el propio `.exe`, sin Internet |

Para compilar la offline, Tauri descarga una vez el instalador independiente
de WebView2 de Microsoft (`go.microsoft.com`). Son **instaladores**, no
ejecutables portátiles: no necesitan Node, Rust ni el repositorio.

## Integración continua y releases

| Workflow | Cuándo | Qué hace |
|---|---|---|
| [`ci.yml`](.github/workflows/ci.yml) | push a `Principal`, pull requests, manual | `npm ci`, `version:check`, pruebas, build del frontend (con `tsc`), tipos del servidor; después compila el instalador online en `windows-latest` y lo deja como *artifact* (14 días). **No publica nada.** |
| [`release.yml`](.github/workflows/release.yml) | push de un tag `vX.Y.Z` | Comprueba el tag (formato, que esté en `Principal`, que coincida con las versiones y que la release no exista), reutiliza `ci.yml` para compilar online **y** offline, genera `SHA256SUMS.txt`, una atestación de procedencia y crea la release con los tres archivos. |

Permisos: `contents: read` en todo salvo el último job de `release.yml`
(`contents: write` para crear la release, `id-token`/`attestations: write`
para la atestación). Las acciones están fijadas por SHA de commit. No se usa
ningún secreto aparte del `GITHUB_TOKEN` automático.

### Publicar una versión

1. Preparar la versión (en una rama o en `Principal`), por ejemplo 1.5.0:
   ```bash
   npm run version:set -- 1.5.0   # package.json, client, Cargo.toml/.lock, lock de npm, insignia del README
   npm run version:check
   npm test && npm run build
   git commit -am "Versión 1.5.0"
   ```
2. Llevar ese commit a `Principal` (`git push`) y esperar a que **CI** pase.
3. Crear y subir el tag desde ese commit:
   ```bash
   git tag -a v1.5.0 -m "Versión 1.5.0"
   git push origin v1.5.0
   ```
4. Seguir el workflow **Release** en la pestaña *Actions* (~15–25 min).
5. Comprobar en *Releases* que `v1.5.0` tiene los dos `.exe` y
   `SHA256SUMS.txt`, y probar el instalador descargado en un Windows.

Si algo falla **antes** de publicarse la release, corrige, borra el tag
(`git push --delete origin v1.5.0 && git tag -d v1.5.0`) y repite desde el
paso 1. Una release ya publicada no se sobrescribe: publica `v1.5.1`. Los tags
antiguos (`version1.1.0`, `versions`) no siguen el formato y el workflow los
ignora.

### Firma de código (pendiente)

Los instaladores se publican **sin firmar**: Windows SmartScreen muestra
«Windows protegió su PC» hasta que el archivo gana reputación (ver
[`INSTALL.md`](INSTALL.md#4-windows-muestra-una-advertencia)). La integridad se
puede comprobar con `SHA256SUMS.txt` y `gh attestation verify`. Para firmar
hace falta un certificado de firma de código real (u Azure Trusted Signing);
Tauri lo admite con `bundle.windows.signCommand` o `certificateThumbprint`, y
el certificado iría como secreto del repositorio, nunca en el código.

### Otras plataformas

Solo se publica Windows x64, que es lo que se compila y prueba. Tauri podría
generar `.deb`/AppImage (Linux) y `.dmg` (macOS) en sus runners, pero no se
han probado y macOS exigiría firma y notarización de Apple para abrirse sin
avisos; la alternativa multiplataforma actual es la web/PWA.

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

Actualizar (instalar encima) conserva esta carpeta; desinstalar la conserva
salvo que se marque la casilla de borrar datos. Pasos para el usuario en
[`INSTALL.md`](INSTALL.md#3-instalar).

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
