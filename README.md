<p align="center">
  <img src="client/src-tauri/icons/icon.png" alt="Icono de Plan Task Gestor" width="112" height="112">
</p>

<h1 align="center">Plan Task Gestor</h1>

<p align="center">
  Tareas, hábitos, calendario, proyectos, notas y finanzas personales en una sola app.<br>
  <b>Local-first</b>: tus datos se guardan en tu dispositivo, funciona sin conexión y no necesita cuentas ni servidores.
</p>

<p align="center">
  <img alt="Versión 1.4.0" src="https://img.shields.io/badge/versión-1.4.0-6366f1">
  <img alt="Estado: en desarrollo activo" src="https://img.shields.io/badge/estado-en_desarrollo_activo-f59e0b">
  <img alt="Plataformas: Windows, Android y web" src="https://img.shields.io/badge/plataformas-Windows_·_Android_·_Web-0ea5e9">
  <br>
  <img alt="React 18" src="https://img.shields.io/badge/React_18-20232A?logo=react&logoColor=61DAFB">
  <img alt="TypeScript 5" src="https://img.shields.io/badge/TypeScript_5-3178C6?logo=typescript&logoColor=white">
  <img alt="Vite 6" src="https://img.shields.io/badge/Vite_6-646CFF?logo=vite&logoColor=white">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri_2-24C8DB?logo=tauri&logoColor=white">
</p>

<p align="center">
  <img src="docs/assets/screenshots/dashboard-desktop.png" alt="Panel principal de Plan Task Gestor en escritorio" width="900">
</p>

---

## Índice

1. [Qué es](#qué-es)
2. [Capturas](#capturas)
3. [Funcionalidades](#funcionalidades)
4. [Instalación](#instalación) — [Android](#android-apk) · [Windows](#windows) · [Web](#web)
5. [Actualizaciones](#actualizaciones)
6. [Tus datos](#tus-datos)
7. [Arquitectura y tecnologías](#arquitectura-y-tecnologías)
8. [Para desarrolladores](#para-desarrolladores)
9. [Estructura del repositorio](#estructura-del-repositorio)
10. [Seguridad](#seguridad)
11. [Estado y limitaciones conocidas](#estado-y-limitaciones-conocidas)

---

## Qué es

Plan Task Gestor es una aplicación de **productividad personal** que reúne en
un mismo lugar lo que normalmente está repartido entre varias apps: lista de
tareas, seguimiento de hábitos, calendario, proyectos con etapas, notas,
objetivos y finanzas personales.

**Para quién:** personas que quieren organizar su trabajo, sus estudios y su
vida personal sin depender de una cuenta en la nube.

**Qué la diferencia de una lista de tareas:**

- Los módulos están **conectados**: las tareas alimentan objetivos y
  estadísticas, los hábitos y las tareas aparecen en el calendario, las metas
  de ahorro se reflejan en los objetivos.
- Es **local-first**: no hay registro, servidor ni telemetría. Todo funciona
  sin Internet y los datos no salen del dispositivo salvo que tú exportes una
  copia de seguridad.
- La **misma app** se instala en Windows (Tauri), en Android (APK) y se usa
  desde el navegador (PWA).

---

## Capturas

Capturas reales del build de producción con los **datos de ejemplo** que la
app crea en una instalación nueva (sin datos personales).

### Escritorio

| Tareas (lista, Kanban e historial) | Calendario |
| :---: | :---: |
| <img src="docs/assets/screenshots/tasks-desktop.png" alt="Gestión de tareas" width="440"> | <img src="docs/assets/screenshots/calendar-desktop.png" alt="Calendario mensual con tareas y eventos" width="440"> |
| **Proyectos (profesional y personal)** | **Hábitos** |
| <img src="docs/assets/screenshots/projects-desktop.png" alt="Gestión de proyectos" width="440"> | <img src="docs/assets/screenshots/habits-desktop.png" alt="Seguimiento de hábitos" width="440"> |
| **Finanzas** | **Copias de seguridad** |
| <img src="docs/assets/screenshots/finance-desktop.png" alt="Módulo de finanzas" width="440"> | <img src="docs/assets/screenshots/backups-desktop.png" alt="Copias de seguridad: crear, descargar, restaurar e importar" width="440"> |

La barra lateral de la izquierda es el **panel de navegación** de escritorio;
en el móvil se convierte en una barra inferior con las secciones principales
y un menú «Más».

### Android

APK de release instalado en un emulador Pixel con Android 14. La barra
inferior sustituye al panel lateral y respeta los botones del sistema.

| Panel principal | Tareas | Proyectos | Notas |
| :---: | :---: | :---: | :---: |
| <img src="docs/assets/screenshots/dashboard-android.png" alt="Panel principal en Android" width="200"> | <img src="docs/assets/screenshots/tasks-android.png" alt="Tareas en Android" width="200"> | <img src="docs/assets/screenshots/projects-android.png" alt="Proyecto en Android" width="200"> | <img src="docs/assets/screenshots/notes-android.png" alt="Nota con cálculo automático en Android" width="200"> |

---

## Funcionalidades

Todos los módulos de esta tabla están **implementados** y disponibles en las
tres plataformas, salvo donde se indica.

| Módulo | Qué permite |
| :--- | :--- |
| **Panel principal** | Resumen del día: tareas pendientes y completadas, hábitos de hoy, próximos eventos, finanzas del mes y progreso de objetivos. |
| **Tareas** | Vistas de lista, Kanban (arrastrar y soltar) e historial. Filtros rápidos (Hoy, Próximas, Vencidas, Sin fecha), prioridades, categorías, etiquetas, subtareas, tareas recurrentes y recordatorios. |
| **Calendario** | Vistas de mes, semana, día y agenda que unifican eventos, tareas con fecha y horarios de hábitos. |
| **Hábitos** | Frecuencia diaria o por días, metas cuantificables (p. ej. 8 vasos), rachas, mapa de calor anual e importación desde una captura de calendario con OCR local. |
| **Proyectos** | Proyectos profesionales con etapas, objetivos, progreso calculado y plantillas reutilizables; proyectos personales (metas) con línea del tiempo. Se pueden mover entre ambos tipos sin perder datos. |
| **Universidad** | Semestres, materias, horario y entregas. |
| **SOP** | Procedimientos operativos estándar y plantillas de procesos reutilizables. |
| **Objetivos** | Metas diarias, semanales, mensuales o anuales con progreso manual, desde tareas vinculadas o desde una meta de ahorro. |
| **Notas** | Editor de texto enriquecido, categorías, adjuntos, papelera, autoguardado y cálculos automáticos (`200+200=` → `400`). |
| **Finanzas** | Cuentas, movimientos, transferencias, presupuestos, metas de ahorro, finalidades, recurrentes, análisis, notas financieras e importación de CSV, Excel, JSON, SQL, SQLite y Cashew. |
| **Estadísticas** | Gráficos de tareas por prioridad, hábitos en el tiempo e índices de productividad. |
| **Categorías y etiquetas** | Organización jerárquica con color e icono, y etiquetas globales. |
| **Copias de seguridad** | En *Configuración › Copias de seguridad*: crear y **exportar** una copia completa (opcionalmente cifrada), **importar** o restaurar una copia (también la de otro dispositivo) con un asistente que muestra su contenido antes de aplicarla, y lista de las **copias encontradas** en la app (automáticas y manuales) para restaurarlas, descargarlas o borrarlas. |
| **Configuración** | Tema claro/oscuro, apariencias, color de acento, tamaño de letra, bloqueo por PIN, recordatorios y paleta de comandos (`Ctrl+K`). |
| **Google Calendar** | Sincronización de hábitos con Google Calendar. **Solo en la versión web**: Google no permite su inicio de sesión dentro de la app instalada. |

---

## Instalación

### Android (APK)

| Dato | Valor |
| :--- | :--- |
| Versión | 1.4.0 (`versionCode` 1004000) |
| Android mínimo | 7.0 (API 24), declarado en el APK; probado en un emulador con Android 14 (API 34) |
| Arquitecturas | arm64-v8a, armeabi-v7a, x86, x86_64 (APK universal: sirve para cualquier teléfono) |
| Tamaño | 61,2 MiB (64,2 MB) |
| Firma | Firmado con la clave de release del proyecto (APK Signature Scheme v2) |
| Identificador | `com.alejandrodukesini.gestortareas` |
| Permisos | Internet (no se usa para tus datos) y notificaciones (se piden al activar los recordatorios) |
| Descarga | **Todavía no hay un APK publicado.** Cuando se publique, estará en [GitHub Releases](https://github.com/AlejandroDukesini/Personal_Task_Gestor/releases) como `PlanTaskGestor_<versión>_android.apk`. |

La app no está en Google Play: se instala directamente desde el archivo
`.apk`. No necesitas cuenta ni conexión para usarla.

#### Paso 1 · Conseguir el APK en el teléfono

Elige **una** de estas opciones:

- **Desde el teléfono (lo más fácil):** abre
  [Releases](https://github.com/AlejandroDukesini/Personal_Task_Gestor/releases)
  en el navegador del teléfono, busca la versión más reciente, despliega
  **Assets** y toca el archivo que termina en **`.apk`**. Si el navegador
  avisa de que «este tipo de archivo puede ser dañino», toca **Descargar de
  todas formas**.
- **Desde el PC con cable USB:** descarga el `.apk` en el PC, conecta el
  teléfono, elige **Transferencia de archivos** en la notificación USB del
  teléfono y copia el archivo a la carpeta **Download** del teléfono.
- **Desde el PC sin cable:** súbelo a Google Drive (o envíatelo por correo o
  Telegram) y descárgalo en el teléfono desde ahí.

#### Paso 2 · Abrir el archivo

Toca la notificación de descarga, o abre la app **Archivos** (o *Mis
archivos*), entra en **Descargas** y toca el `.apk`.

#### Paso 3 · Permitir la instalación (solo la primera vez)

Android bloquea por defecto las apps que no vienen de Play Store. La primera
vez verás un aviso como *«Por tu seguridad, tu teléfono no puede instalar
apps desconocidas de esta fuente»*:

1. Toca **Configuración** en ese aviso.
2. Activa **Permitir desde esta fuente**. El permiso se da solo a la app con
   la que abriste el APK (el navegador o *Archivos*).
3. Pulsa **atrás** (←) para volver a la instalación.

> Si no aparece el aviso, el permiso está en *Ajustes › Aplicaciones ›
> Acceso especial › Instalar apps desconocidas*. El nombre exacto cambia
> según la marca del teléfono.

#### Paso 4 · Instalar

1. Toca **Instalar** y espera unos segundos.
2. Si **Play Protect** muestra un aviso de *app desconocida* o *app no
   segura*, toca **Más detalles › Instalar de todas formas**. Aparece porque
   la app no está publicada en Play Store, no porque se haya detectado algo.
3. Toca **Abrir**, o búscala como **Plan Task Gestor** en el cajón de
   aplicaciones.

Puedes empezar a usarla directamente. Si activas recordatorios, Android te
pedirá permiso para enviar notificaciones.

Opcional, por seguridad: después de instalar, vuelve a desactivar *Instalar
apps desconocidas* para el navegador o *Archivos*.

#### Actualizar a una versión nueva

Descarga el APK nuevo y repite los pasos 2 y 4 **sin desinstalar** la
versión actual: Android la reemplaza y **tus datos se conservan**. Android
solo acepta la actualización si el APK nuevo tiene el mismo identificador,
la misma clave de firma y un número de versión mayor. Por precaución,
exporta antes una copia en *Configuración › Copias de seguridad*.

#### Problemas frecuentes

| Mensaje | Qué hacer |
| :--- | :--- |
| «No se instaló la app» o «conflicto con un paquete existente» | Tienes instalado un APK firmado con otra clave (por ejemplo, una compilación de prueba) o una versión más nueva. Exporta una copia de seguridad, desinstala la app, instala el APK nuevo e importa la copia. |
| «Error al analizar el paquete» | La descarga se cortó o el teléfono tiene una versión anterior a Android 7.0. Descarga el archivo de nuevo. |
| No hay botón **Instalar** | Falta el permiso del paso 3, o el gestor de archivos no puede instalar APK: ábrelo desde la notificación de descarga del navegador. |

> **Desinstalar la app borra sus datos.** Antes de desinstalar o cambiar de
> teléfono, exporta una copia en *Configuración › Copias de seguridad* y
> guárdala fuera del teléfono (Drive, PC, correo). En el teléfono nuevo,
> instala la app e importa esa copia.

### Windows

| Dato | Valor |
| :--- | :--- |
| Versión | 1.4.0 |
| Sistema | Windows 10/11 de 64 bits (x64) |
| Formato | Instalador NSIS (`.exe`), por usuario, sin permisos de administrador |
| Tamaño | 11,6 MiB (instalador online; descarga WebView2 solo si falta). Existe una variante offline que incluye WebView2. |
| Firma | **Sin firmar**: Windows SmartScreen puede mostrar «Windows protegió su PC» |
| Descarga | **Todavía no hay instaladores publicados para la 1.4.0.** Las releases existentes ([`v1.1.0 BETA`](https://github.com/AlejandroDukesini/Personal_Task_Gestor/releases)) no incluyen archivos. Se publicarán en [GitHub Releases](https://github.com/AlejandroDukesini/Personal_Task_Gestor/releases) (ver [Publicar una versión](#publicar-una-versión)). |

#### Paso 1 · Elegir y descargar el instalador

Abre [Releases](https://github.com/AlejandroDukesini/Personal_Task_Gestor/releases),
busca la versión más reciente y despliega **Assets**:

| Archivo | Cuándo usarlo |
| :--- | :--- |
| **`PlanTaskGestor_<versión>_x64-setup.exe`** | **Recomendado.** Instalador normal (~12 MB). Solo necesita Internet si al equipo le falta WebView2 (Windows 11 ya lo trae). |
| `PlanTaskGestor_<versión>_x64-offline-setup.exe` | Equipos sin Internet (~220 MB, incluye WebView2). |

Si el navegador avisa de que el archivo «no se descarga habitualmente»,
abre el menú de esa descarga (**⋯**) y elige **Conservar** (en Edge:
*Conservar › Mostrar más › Conservar de todas formas*).

#### Paso 2 · Ejecutar el instalador

1. Abre la carpeta **Descargas** y haz doble clic en el `.exe`.
2. Si aparece **«Windows protegió su PC»** (SmartScreen), pulsa **Más
   información** y después **Ejecutar de todas formas**. Aparece porque el
   instalador todavía no tiene firma de código.
3. No pide permisos de administrador: se instala solo para tu usuario.

#### Paso 3 · Seguir el asistente

1. Pulsa **Siguiente**.
2. Deja la carpeta de instalación propuesta (o elige otra) y pulsa
   **Instalar**.
3. Si falta WebView2, el instalador lo descarga e instala solo: espera a que
   termine.
4. Pulsa **Finalizar**.

#### Paso 4 · Abrir la app

Búscala como **Plan Task Gestor** en el menú Inicio o usa el acceso directo.
La ventana se abre maximizada. Para tenerla a mano: clic derecho en su icono
de la barra de tareas › **Anclar a la barra de tareas**.

#### Actualizar a una versión nueva

Cierra la app, descarga el instalador nuevo y ejecútalo **sin desinstalar**
la versión actual: la reemplaza y **tus datos se conservan**.

#### Verificar la descarga (opcional)

Cada release incluye `SHA256SUMS.txt` y una atestación de procedencia de
GitHub. En PowerShell, dentro de la carpeta de descargas:

```powershell
Get-FileHash .\PlanTaskGestor_<versión>_x64-setup.exe        # compárala con SHA256SUMS.txt
gh attestation verify PlanTaskGestor_<versión>_x64-setup.exe -R AlejandroDukesini/Personal_Task_Gestor
```

#### Desinstalar

*Configuración de Windows › Aplicaciones › Aplicaciones instaladas › Plan
Task Gestor › Desinstalar*. Si no marcas la casilla de borrar datos, se
conservan en `%LOCALAPPDATA%\com.alejandrodukesini.gestortareas` y una
reinstalación los vuelve a ver.

> **Si tenías la app con su nombre anterior, «Plan Gestor Task»:** el
> instalador nuevo se instala aparte y **ve los mismos datos**. Puedes
> desinstalar la entrada antigua, pero **no marques la casilla de borrar
> datos**: es la misma carpeta que usa la app nueva.

### Web

La versión web está publicada en **[task-gestor.netlify.app](https://task-gestor.netlify.app/)**.
Funciona en cualquier navegador actual y se puede instalar como app (PWA)
desde el menú del navegador. Sus datos son independientes de los de las apps
de Windows y Android.

---

## Actualizaciones

| Plataforma | Cómo se actualiza |
| :--- | :--- |
| Android | Manualmente: instalando el APK de la versión nueva encima del actual (misma clave de firma). |
| Windows | Manualmente: ejecutando el instalador de la versión nueva encima del actual. |
| Web / PWA | Automáticamente: al publicar una versión, la app muestra un aviso para recargar. |

**La app instalada no se actualiza sola** (no incluye actualizador automático)
y no está publicada en Google Play ni en Microsoft Store.

---

## Tus datos

- Se guardan **solo en el dispositivo**: IndexedDB de la WebView como
  almacenamiento principal, una copia espejo en `localStorage` y puntos de
  restauración automáticos.
- Sobreviven a cerrar la app, reiniciar y actualizar.
- Cada plataforma tiene **sus propios datos** y no hay sincronización entre
  dispositivos. Para pasarlos de uno a otro: exporta una **copia de
  seguridad** en el primero e impórtala en el segundo.
- Haz copias periódicas (*Configuración › Copias de seguridad*): son la única
  protección frente a una desinstalación o la pérdida del dispositivo.

---

## Arquitectura y tecnologías

```text
┌──────────────────────── Interfaz (React + Vite) ────────────────────────┐
│  páginas y componentes  →  services/api.ts  →  services/localApi.ts     │
│                                    (rutas REST resueltas en local)       │
│                                              ↓                           │
│                 services/storage.ts: IndexedDB + espejo + restauración   │
└──────────────────────────────────────────────────────────────────────────┘
        Web (PWA)          Windows: Tauri 2 + WebView2      Android: Tauri 2 + WebView
```

- **Sin backend:** las páginas llaman a una API con forma REST que se resuelve
  dentro de la propia app (`localApi.ts`), sobre el almacenamiento local.
- **Sin Internet:** todo funciona sin conexión. Solo usan red, si los
  activas, Google Calendar (web) y los enlaces externos.
- **Windows y Android** empaquetan el mismo build de Vite con Tauri 2. El
  código nativo es mínimo: abre enlaces en el navegador del sistema, lanza
  notificaciones y, en Android, guarda archivos con el selector del sistema
  (la WebView de Android no permite descargas directas).

| Capa | Tecnología (versión instalada) |
| :--- | :--- |
| Interfaz | React 18.3.1, TypeScript 5.9.3, Vite 6.4.5, Tailwind CSS 3.4.19, React Router 7.18.4, Zustand 5.0.16, Framer Motion 11.18.2 |
| Componentes | FullCalendar 6.1.22, Tiptap 3.32.0 (editor de notas), Recharts 2.15.4 (gráficos), Tesseract.js 7.0.0 (OCR local) |
| Validación | Zod 4.6.7 |
| Persistencia | IndexedDB + `localStorage` (sin SQLite: el volcado SQL de finanzas es solo exportación) |
| Apps nativas | Tauri 2.12.5 (CLI 2.12.4), Rust estable; plugins `opener`, `notification` y, en Android, `dialog` + `fs` |
| Android | Gradle 9.6.1, Android Gradle Plugin 9.3.1, Kotlin 2.2.10, compileSdk/targetSdk 37, minSdk 24, NDK 29 |
| Pruebas | Vitest 4.1.12 con happy-dom y fake-indexeddb |

---

## Para desarrolladores

### Requisitos

- **Node.js 24** (fijado en `.nvmrc`) y npm.
- **Windows:** Rust estable (`stable-x86_64-pc-windows-msvc`) y Visual Studio
  Build Tools 2022 con «Desarrollo de escritorio con C++».
- **Android:** además, Android SDK, NDK 29, JDK 21 y los targets de Rust para
  Android. Paso a paso en **[`docs/ANDROID_BUILD.md`](docs/ANDROID_BUILD.md)**.

### Instalar y ejecutar

```bash
git clone https://github.com/AlejandroDukesini/Personal_Task_Gestor.git
cd Personal_Task_Gestor
npm ci            # dependencias exactas del package-lock
npm run dev       # app web en http://localhost:5173 (sin backend ni base de datos)
```

### Comandos

| Comando | Qué hace |
| :--- | :--- |
| `npm run dev` | Servidor de desarrollo (Vite). |
| `npm run build` | Comprueba tipos (`tsc`) y genera el build de producción en `client/dist`. |
| `npm run preview` | Sirve el build de producción en local. |
| `npm test` | Pruebas del cliente (Vitest). |
| `npm run desktop:dev` | App de Windows con recarga en caliente. |
| `npm run desktop:build` | Instalador de Windows online → `client/src-tauri/target/release/bundle/nsis/`. |
| `npm run desktop:build:offline` | Instalador de Windows con WebView2 incluido. |
| `npm run android:dev` | App de Android en un emulador o dispositivo conectado. |
| `npm run android:build` | APK de release firmado → `client/src-tauri/gen/android/app/build/outputs/apk/universal/release/`. |
| `npm run version:check` | Comprueba que la versión coincide en todos los archivos. |
| `npm run version:set -- X.Y.Z` | Cambia la versión en todos los archivos (incluida la insignia de este README). |
| `npm run sql:gen` | Regenera el SQL de referencia del módulo de finanzas. |

### Firma de Android

El APK de release se firma con un keystore que **no está en el
repositorio**: Gradle lo busca en `%USERPROFILE%\.plantaskgestor-keys\keystore.properties`
o en la ruta de la variable `PLANTASK_KEYSTORE_PROPERTIES`. Todas las
versiones futuras deben firmarse **con la misma clave**; si se pierde, no se
podrán publicar actualizaciones que se instalen encima. Detalles en
[`docs/ANDROID_BUILD.md`](docs/ANDROID_BUILD.md).

### Publicar una versión

1. `npm run version:set -- X.Y.Z`, `npm test`, `npm run build` y commit.
2. Llevar el commit a `Principal` y esperar a que pase **CI**
   ([`ci.yml`](.github/workflows/ci.yml): pruebas, build e instalador de prueba).
3. Crear y subir el tag: `git tag -a vX.Y.Z -m "Versión X.Y.Z" && git push origin vX.Y.Z`.
4. [`release.yml`](.github/workflows/release.yml) compila los instaladores de
   Windows (online y offline), genera `SHA256SUMS.txt` y la atestación, y crea
   la release. Nunca sobrescribe una release existente.
5. **El APK no se compila en CI** (la clave de firma no está en GitHub): hay
   que generarlo en local con `npm run android:build`, renombrarlo a
   `PlanTaskGestor_X.Y.Z_android.apk` y adjuntarlo a la release a mano
   (`gh release upload vX.Y.Z PlanTaskGestor_X.Y.Z_android.apk`).

---

## Estructura del repositorio

```text
Personal_Task_Gestor/
├── README.md                  # este documento
├── package.json               # workspaces (client, server) y scripts
├── netlify.toml               # despliegue de la versión web y cabeceras de seguridad
├── .github/workflows/         # CI y publicación de releases
├── scripts/version.mjs        # versión única en todos los archivos
├── docs/
│   ├── ANDROID_BUILD.md       # compilación y firma del APK
│   └── assets/screenshots/    # capturas de este README
├── client/                    # la aplicación
│   ├── src/                   # React: pages, components, services, store, hooks, lib
│   ├── public/                # iconos, manifest de la PWA y service worker
│   └── src-tauri/             # contenedor nativo (Rust, Tauri)
│       ├── src/               # lib.rs / main.rs
│       ├── capabilities/      # permisos (comunes y solo Android)
│       ├── icons/
│       ├── gen/android/       # proyecto Android (Gradle)
│       ├── tauri.conf.json    # configuración común + Windows
│       └── tauri.android.conf.json
└── server/                    # backend Express + Prisma heredado (la app no lo usa);
                               # conserva las migraciones SQL de finanzas que validan las pruebas
```

---

## Seguridad

- Sin cuentas, sin servidor y sin telemetría: los datos no salen del
  dispositivo salvo que los exportes.
- Copias de seguridad cifrables con AES-256-GCM
  (clave derivada con PBKDF2-SHA256); la contraseña nunca se guarda.
- Bloqueo opcional por PIN.
- Política de seguridad de contenido (CSP) estricta en las apps nativas y en la web.
- Permisos mínimos en Android: sin acceso a contactos, ubicación, cámara,
  micrófono ni almacenamiento general (los archivos se guardan donde tú
  eliges con el selector del sistema).
- El keystore de Android y sus contraseñas están fuera del repositorio
  (`.gitignore` excluye `*.jks`, `*.keystore` y `keystore.properties`).

---

## Estado y limitaciones conocidas

- **En desarrollo activo** (versión 1.4.0, rama `Beta`).
- No hay instaladores ni APK publicados todavía para la 1.4.0.
- El instalador de Windows **no está firmado** con un certificado de código.
- Los **recordatorios** solo se lanzan con la app abierta: no hay servicio en
  segundo plano.
- **Google Calendar** solo está disponible en la versión web.
- En Android, el botón **Atrás** vuelve a la pantalla anterior; si hay un
  panel abierto (menú «Más», formulario) se cierra junto con ese cambio de
  pantalla, en lugar de cerrarse solo el panel.
- El APK se ha probado en un emulador (Android 14), todavía no en un
  teléfono físico.
- Los **adjuntos de las notas** entran en la copia descargada mientras esté
  marcada «Incluir los archivos adjuntos» (opción activada por defecto).
- El proyecto **no tiene licencia definida** todavía.
