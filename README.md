<p align="center">
  <img width="1919" alt="Captura del panel principal de Plan Gestor Task" src="https://github.com/user-attachments/assets/55da33d2-d56b-4b5d-ac0d-56b07cc35a46" />
</p>

<h1 align="center">🚀 Plan Gestor Task — Sistema de Productividad Personal</h1>

<p align="center">
  <b>Tareas · Hábitos · Calendario · Objetivos · Finanzas · Notas</b><br>
  Local-First: tus datos viven en tu dispositivo, funcionan sin conexión y se sincronizan solo cuando tú lo decides.
</p>

<p align="center">
  <a href="https://task-gestor.netlify.app/"><img alt="Demo en vivo" src="https://img.shields.io/badge/Demo-en_vivo-6366f1?logo=netlify&logoColor=white"></a>
  <img alt="Versión 1.3.0" src="https://img.shields.io/badge/versión-1.3.0-blue">
  <img alt="Lighthouse SEO 100" src="https://img.shields.io/badge/Lighthouse_SEO-100-brightgreen?logo=lighthouse&logoColor=white">
  <img alt="Lighthouse Best Practices 100" src="https://img.shields.io/badge/Best_Practices-100-brightgreen?logo=lighthouse&logoColor=white">
  <img alt="Lighthouse Accessibility 100" src="https://img.shields.io/badge/Accessibility-100-brightgreen?logo=lighthouse&logoColor=white">
  <img alt="Lighthouse Performance 92" src="https://img.shields.io/badge/Performance-92-brightgreen?logo=lighthouse&logoColor=white">
  <br>
  <img alt="React 18" src="https://img.shields.io/badge/React_18-20232A?logo=react&logoColor=61DAFB">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white">
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white">
  <img alt="IndexedDB" src="https://img.shields.io/badge/IndexedDB-local--first-orange">
  <img alt="PWA" src="https://img.shields.io/badge/PWA-offline-5A0FC8?logo=pwa&logoColor=white">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri_2-Windows-24C8DB?logo=tauri&logoColor=white">
</p>

Una plataforma modular de productividad personal al estilo **Notion + Todoist + Google Calendar + Habit Tracker**, con gestión financiera y notas integradas. Está diseñada bajo el concepto **Local-First**: no hay cuentas, ni servidores en la nube, ni telemetría. Toda la información se guarda en el navegador (IndexedDB) o en la app de escritorio, lo que garantiza privacidad, rapidez y funcionamiento completo sin conexión.

**Disponible como:**

| Plataforma | Cómo usarla |
| :--- | :--- |
| 🌐 **Web** | [task-gestor.netlify.app](https://task-gestor.netlify.app/) (sitio estático en Netlify) |
| 📱 **iPhone / Android** | PWA instalable desde el navegador («Añadir a pantalla de inicio») |
| 🖥️ **Windows** | App de escritorio nativa con Tauri 2 — ver [`DESKTOP.md`](DESKTOP.md) |
| 💻 **PC en red local** | `npm run pc` sirve la app y el relé de sincronización — ver [`sync/README.md`](sync/README.md) |

---

## 📋 Índice

1. [Características principales](#-características-principales)
2. [Inicio rápido](#-inicio-rápido)
3. [Arquitectura](#-arquitectura)
4. [Estructura del proyecto](#-estructura-del-proyecto)
5. [Tecnologías](#️-tecnologías)
6. [Rendimiento y escalabilidad](#-rendimiento-y-escalabilidad-métricas-reales)
7. [Módulo de Finanzas](#-módulo-de-finanzas)
8. [Módulo de Notas](#-módulo-de-notas)
9. [Hábitos: metas, horarios, Google Calendar y capturas](#-hábitos-metas-horarios-google-calendar-y-capturas)
10. [iPhone, almacenamiento y actualizaciones](#-iphone-almacenamiento-y-actualizaciones)
11. [Pruebas](#-pruebas)
12. [Scripts disponibles](#️-scripts-disponibles)
13. [Referencia de la API](#-referencia-de-la-api)
14. [Seguridad y respaldos](#️-seguridad-y-respaldos)
15. [Documentación adicional](#-documentación-adicional)

---

## ✨ Características principales

| Módulo | Qué ofrece |
| :--- | :--- |
| 📊 **Dashboard** | Widgets con las tareas prioritarias de hoy, seguimiento rápido de hábitos, próximos eventos y progreso de objetivos del mes. |
| 📋 **Tareas** | Vistas de **lista**, **Kanban** (arrastrar y soltar), **calendario** e **historial** (completadas por día, marcando si se cerraron a tiempo). Vistas rápidas (Hoy, Próximas, Vencidas, Sin fecha), filtros y ordenación. **Recurrentes** (diaria, laborables, semanal, mensual, anual) con id determinista, sin duplicados entre dispositivos. **Recordatorios relativos** que se recalculan al mover la fecha. Vínculo con objetivos. |
| 🔁 **Hábitos** | Frecuencia diaria o por días concretos, **metas cuantificables** (8 vasos, 30 min…), rachas, horarios con zona horaria, sincronización opcional con **Google Calendar** e importación desde **capturas de calendario** con OCR local. |
| 📅 **Calendario** | Vistas de mes, semana, día y agenda (*FullCalendar*) que unifican eventos, tareas con fecha y horarios de hábitos. |
| 🎯 **Objetivos** | Metas diarias, semanales, mensuales o anuales con progreso manual, **calculado desde tareas vinculadas** o **desde una meta de ahorro** (se calcula al leer; nunca se copia). |
| 💰 **Finanzas** | Cuentas, movimientos, transferencias, presupuestos, metas de ahorro, recurrentes, análisis e **importación universal** (CSV, Excel, JSON, SQL, SQLite, Cashew). |
| 📝 **Notas** | Editor de texto enriquecido, categorías, adjuntos, papelera, autoguardado con recuperación y **cálculos automáticos** (`200+200=` → `400`). |
| 📈 **Estadísticas** | Gráficos (*Recharts*) de tareas por prioridad, hábitos completados en el tiempo e índices de productividad. |
| 🗂️ **Categorías y etiquetas** | Carpetas jerárquicas con color e icono, y etiquetas globales para organización cruzada. |
| 🔄 **Sincronización** | Manual iPhone ↔ PC por Wi‑Fi (cifrada de extremo a extremo) o con archivos cifrados. Motor a tres bandas con revisión de conflictos (los financieros siempre los decides tú). |
| ⚙️ **Configuración** | Tema claro/oscuro/sistema, color de acento, escala de fuente, **bloqueo por PIN**, copias de seguridad automáticas y cifradas, y paleta de comandos (`Ctrl+K`). |

---

## 🏁 Inicio rápido

### Requisitos
*   **Node.js 20+** (la versión con la que compila Netlify) y `npm`.
*   Solo para la app de escritorio: Rust y Visual Studio Build Tools (ver [`DESKTOP.md`](DESKTOP.md)).

### Pasos

```bash
# 1. Clonar el repositorio
git clone https://github.com/AlejandroDukesini/Personal_Task_Gestor.git
cd Personal_Task_Gestor

# 2. Instalar dependencias (npm workspaces: client, server y sync)
npm install

# 3. Arrancar la app en modo desarrollo
npm run dev
```

Abre `http://localhost:5173`. No hace falta base de datos ni backend: los datos se crean en el almacenamiento del navegador la primera vez que abres la app.

### Otras formas de ejecutarla

```bash
npm run build && npm run preview   # build de producción servido localmente
npm run pc                         # build + relé de sincronización en http://localhost:4181
npm run desktop:dev                # app de escritorio (Tauri) con recarga en caliente
```

### Variables de entorno (opcionales)

| Variable | Dónde | Para qué |
| :--- | :--- | :--- |
| `VITE_GOOGLE_CLIENT_ID` | `client/.env` (ver `client/.env.example`) o Netlify | Habilitar la integración con Google Calendar. También se puede pegar en Configuración › Integraciones. |

---

## 🧭 Arquitectura

La app es **100 % estática**: el build de Vite (`client/dist`) contiene todo lo necesario y se despliega en Netlify sin servidor.

```mermaid
graph TD
    UI[Páginas React] -->|api.get / api.post …| API[services/api.ts]
    API -->|copia previa en operaciones destructivas| BK[Copias de seguridad]
    API -->|handleRequest método + ruta| LAPI[services/localApi.ts<br/>rutas tipo REST en el navegador]
    LAPI --> DB[(localDb · IndexedDB<br/>+ espejo en localStorage)]
    DB <-->|manual y cifrada| SYNC[Relé sync/ · archivos cifrados]
    DB <-->|opcional| GCAL[Google Calendar API]
```

*   **Misma interfaz, sin red**: [`client/src/services/api.ts`](client/src/services/api.ts) conserva la forma de un cliente HTTP (`get`, `post`, `put`, `patch`, `delete`), pero cada petición se resuelve en [`localApi.ts`](client/src/services/localApi.ts) contra la base local. Las páginas no necesitan saber si hay servidor.
*   **Persistencia robusta**: IndexedDB con migraciones versionadas, copia espejo en `localStorage`, fusión fila a fila entre pestañas y copia verificada antes de cualquier operación destructiva.
*   **Reglas de negocio centralizadas** en [`rules.ts`](client/src/services/rules.ts) (fechas coherentes, campos obligatorios, precondiciones), documentadas en [`REGLAS_DE_NEGOCIO.md`](REGLAS_DE_NEGOCIO.md).
*   **Backend de referencia**: la carpeta [`server/`](server) contiene la implementación original con **Express + Prisma + SQLite**. No se despliega, pero se mantiene como referencia de la API y para los benchmarks de base de datos (`npm run db:setup` y luego `npm run dev:server`, en el puerto 4000).

---

## 📁 Estructura del proyecto

Monorepo administrado con **npm workspaces**:

```
Gestion_tareas/
├── client/                     # App React + Vite (web, PWA y escritorio)
│   ├── public/                 # Iconos, manifest, robots.txt, sitemap.xml
│   ├── scripts/                # Generación de migraciones SQL de finanzas
│   ├── src/
│   │   ├── components/         # Componentes UI reutilizables (incl. paleta de comandos)
│   │   ├── hooks/              # Hooks personalizados
│   │   ├── layouts/            # Layout principal (barra lateral / pestañas móviles)
│   │   ├── lib/                # Utilidades (dinero en céntimos, i18n, escritorio)
│   │   ├── pages/              # Dashboard, Tasks, Habits, Calendar, Goals, Finance, Notes, Stats…
│   │   ├── services/           # Capa de datos local-first
│   │   │   ├── api.ts          # Cliente con interfaz HTTP que resuelve en local
│   │   │   ├── localApi.ts     # Rutas tipo REST sobre la base local
│   │   │   ├── localDb.ts      # Base local versionada y migraciones
│   │   │   ├── rules.ts        # Reglas de negocio
│   │   │   ├── backup/         # Copias de seguridad y restauración
│   │   │   ├── finance/        # Finanzas e importación universal
│   │   │   ├── notes/          # Notas, cálculos y adjuntos
│   │   │   ├── habits/         # Metas y horarios de hábitos
│   │   │   ├── gcal/           # Integración con Google Calendar
│   │   │   ├── screenshot/     # OCR de capturas de calendario
│   │   │   ├── manualsync/     # Motor de sincronización manual
│   │   │   └── persistence/    # IndexedDB, espejo y recuperación
│   │   ├── store/              # Estado global con Zustand
│   │   ├── themes/             # Temas y color de acento
│   │   └── types/              # Tipos TypeScript compartidos
│   ├── src-tauri/              # Envoltorio nativo de escritorio (Tauri 2)
│   └── vite.config.ts
├── server/                     # Backend de referencia (Express + Prisma + SQLite)
│   ├── prisma/schema.prisma
│   └── src/routes/             # tasks, habits, goals, events, stats, backup…
├── sync/                       # Relé de sincronización PC ↔ móvil
├── DESKTOP.md                  # Guía de la versión de escritorio
├── REGLAS_DE_NEGOCIO.md        # Reglas de negocio y códigos de error
├── netlify.toml                # Build y cabeceras de seguridad del despliegue
└── package.json                # Workspaces y scripts globales
```

---

## 🛠️ Tecnologías

| Capa | Tecnologías |
| :--- | :--- |
| **Interfaz** | React 18, TypeScript, Vite, Tailwind CSS, Framer Motion, Lucide React |
| **Estado y datos** | Zustand, IndexedDB, Web Crypto (AES-256-GCM, PBKDF2, SHA-256) |
| **Vistas especializadas** | FullCalendar (calendario), Recharts (estadísticas), @hello-pangea/dnd (Kanban), TipTap / ProseMirror (notas), Tesseract.js (OCR local) |
| **Escritorio** | Tauri 2 (WebView2, instalador NSIS) |
| **Pruebas** | Vitest (cliente), `node:test` (relé de sincronización) |
| **Backend de referencia** | Node.js, Express, Prisma ORM, SQLite, Zod |
| **Despliegue** | Netlify (sitio estático con CSP y cabeceras de seguridad) |

---

## ⚡ Rendimiento y Escalabilidad (Métricas Reales)

> Todas las cifras de esta sección son **medidas**, no estimadas. Se obtuvieron con herramientas estándar de la industria (Google Lighthouse, `EXPLAIN QUERY PLAN` de SQLite y benchmarks de latencia sobre HTTP) ejecutadas contra el *build de producción* de este mismo repositorio. Cada apartado incluye la metodología para que cualquiera pueda reproducirlas.

Bajo la premisa **Local-First**, el objetivo de ingeniería no es "aguantar carga masiva" (es una app mono-usuario), sino **minimizar latencia y peso** eliminando el trabajo innecesario del camino crítico: menos JavaScript bloqueante en el arranque, agregaciones resueltas en una sola pasada y consultas que atacan índices en lugar de escanear tablas.

### 🎨 Frontend — Google Lighthouse

Auditoría de Lighthouse ejecutada **contra el sitio desplegado en producción** ([task-gestor.netlify.app](https://task-gestor.netlify.app/), con CDN de Netlify), en perfiles móvil y escritorio. Cualquiera puede reproducir estas cifras auditando la URL:

| Categoría | 📱 Móvil | 🖥️ Escritorio |
| :--- | :---: | :---: |
| **SEO** | **100** | **100** |
| **Best Practices** | **100** | **100** |
| **Accessibility** | **100** | **100** |
| **Performance** | 73 * | **92** * |

<sub>\* En móvil Lighthouse simula una CPU 4× más lenta y una red 4G; la puntuación de *Performance* varía según red/CPU, pero los Web Vitals se mantienen dentro de los umbrales "buenos". Las auditorías de contraste de color (`color-contrast`) y jerarquía de encabezados (`heading-order`) pasan sin errores.</sub>

**Core Web Vitals (producción):**

| Métrica | 📱 Móvil | 🖥️ Escritorio | Umbral "Bueno" |
| :--- | :---: | :---: | :---: |
| **LCP** (Largest Contentful Paint) | 3.1 s | **1.4 s** | < 2.5 s |
| **TBT** (Total Blocking Time) | 280 ms | 100 ms | < 200 ms |
| **CLS** (Cumulative Layout Shift) | 0.00 | 0.037 | < 0.1 |

### 📦 Optimización del Bundle — Code Splitting

El punto de entrada empaquetaba **toda** la aplicación (incluidas librerías pesadas de visualización) en un único fichero JavaScript. Se aplicó **carga diferida por ruta** (`React.lazy` + `Suspense`) y **separación manual de vendors** (`manualChunks` de Rollup/Vite), sacando del arranque las dependencias que solo se usan en secciones concretas:

| | Antes | Después |
| :--- | :--- | :--- |
| **JS de arranque (gzip)** | **365 kB** (un solo chunk) | **~136 kB** en la ruta de entrada |
| **Nº de chunks** | 1 monolítico | 25 (cacheables por separado) |
| **Recharts** (411 kB) | En el bundle inicial | Diferido → solo en `/estadisticas` |
| **FullCalendar** (268 kB) | En el bundle inicial | Diferido → solo en `/calendario` |

> **679 kB de librerías de visualización (el ~54 % del bundle original) salieron de la ruta crítica**, reduciendo el JavaScript bloqueante del primer render en **~63 %**. Vite deja de emitir el aviso de *chunk > 500 kB*.

### 🔎 SEO Técnico Profesional (Lighthouse SEO 100/100)

El `index.html` no se sirve "pelado": implementa una capa de SEO técnico de nivel producción que consigue **puntuación perfecta de SEO (100/100)** en Lighthouse — móvil y escritorio — con **cero auditorías de SEO fallidas**, verificado sobre el sitio en vivo. Todo está declarado de forma estática, por lo que es visible para los *crawlers* incluso antes de que hidrate React.

| Optimización | Implementación | Beneficio |
| :--- | :--- | :--- |
| **Meta description** optimizada | `<meta name="description">` (~160 car.) | *Snippet* atractivo en resultados de búsqueda |
| **Open Graph** completo | `og:title`, `og:description`, `og:image`, `og:url`, `og:locale`… | Preview enriquecido al compartir en LinkedIn / Facebook / WhatsApp |
| **Twitter Cards** | `summary_large_image` con imagen 1607×816 | Tarjeta visual grande al compartir en X |
| **Datos estructurados** | JSON-LD `schema.org/WebApplication` | Elegibilidad para *rich results* en Google |
| **URL canónica** | `<link rel="canonical">` | Evita contenido duplicado |
| **Directivas de robots** | `index, follow, max-image-preview:large` | Control explícito del rastreo/indexación |
| **`robots.txt` + `sitemap.xml`** | Ficheros estáticos en `public/` | Rastreo guiado de las 6 rutas principales |
| **PWA / `site.webmanifest`** | `theme-color`, iconos maskable 192/512, `apple-touch-icon` | Instalable, con marca coherente en móvil |
| **Fallback `<noscript>`** | Contenido semántico sin JS | Accesible para bots que no ejecutan JavaScript |
| **`lang="es"` + semántica** | Idioma declarado, jerarquía de encabezados | Accesibilidad 100 |

> **Resultado:** el sitio pasa de un SEO de 82 a **100/100**, entrega una tarjeta social profesional al compartirse y es indexable, instalable como PWA y accesible. Es la diferencia entre "un proyecto que funciona" y "un proyecto listo para producción".

### 🗄️ Backend de referencia (`server/`) — Latencia de la API

> El backend Express no forma parte del despliegue actual (la app web es 100 % estática), pero se conserva como implementación de referencia de la API y estas cifras siguen siendo reproducibles con `npm run dev:server`.

Benchmark de latencia sobre HTTP (500 peticiones por endpoint, tras *warm-up*) contra el stack completo `Express → Prisma → SQLite`. El endpoint más pesado, `GET /stats/summary`, resuelve **6 agregaciones en paralelo** (`Promise.all`) más el cálculo de series temporales de 30 días en memoria:

| Endpoint | Media | p95 | p99 |
| :--- | :---: | :---: | :---: |
| `GET /stats/summary` (dashboard) | 13.3 ms | 30.3 ms | 34.6 ms |
| `GET /tasks` (listado + relaciones) | 5.1 ms | 6.3 ms | 9.4 ms |
| `GET /habits` (con historial de logs) | 4.4 ms | 5.1 ms | 6.3 ms |

*El listado de tareas evita el problema **N+1** cargando `category`, `tags` y `reminders` en una única consulta batcheada mediante `include` de Prisma.*

### 🔍 Optimización de Base de Datos — Índice Compuesto

Escenario de escala controlado: se sembró una copia desechable de la base de datos con **50.000 tareas** y se midió la consulta caliente del dashboard (`WHERE status = ? AND completedAt >= ?`) **antes y después** de añadir un índice compuesto `@@index([status, completedAt])`, verificando el plan de ejecución real con `EXPLAIN QUERY PLAN`:

| | Plan de ejecución | Tiempo (mediana, 40 corridas) |
| :--- | :--- | :---: |
| **Antes** | `SCAN Task` (escaneo completo) | 7.56 ms |
| **Después** | `SEARCH Task USING COVERING INDEX` | **0.596 ms** |

$$\text{Mejora} = \frac{7.56 - 0.596}{7.56} \times 100 = \mathbf{92.1\%}$$

> El índice pasó de un *full table scan* a un **covering index** (SQLite resuelve la consulta leyendo solo el índice, sin tocar la tabla). El índice está aplicado en [`schema.prisma`](server/prisma/schema.prisma) y respaldado por los patrones de consulta reales de `stats.ts` y `tasks.ts`.

---

## 💰 Módulo de Finanzas

Sección **Finanzas** (`/finanzas`) con pestañas: Resumen, Movimientos, Cuentas, Presupuestos, Ahorro, Recurrentes, Análisis y Datos. Filtro temporal por día, semana, mes, trimestre, año o rango libre, con navegación anterior/siguiente.

| Funcionalidad | Detalle |
| :--- | :--- |
| **Cuentas** | Efectivo, banco, ahorro, tarjeta de crédito, billetera digital, inversión y personalizada. Moneda, saldo inicial, color, icono, archivado. Solo se borran si no tienen historial (si no, se archivan). Ajuste de saldo por conciliación con motivo. |
| **Movimientos** | Ingreso, gasto, **transferencia** (no cuenta como ingreso ni gasto; admite monedas distintas indicando lo recibido) y **corrección** (con signo y motivo obligatorio). Búsqueda, filtros, ordenación, edición, borrado y exportación CSV. |
| **Categorías y etiquetas** | 16 categorías iniciales (alimentación, vivienda, transporte, salud, educación, suscripciones, salario…). Las etiquetas se comparten con Tareas. |
| **Presupuestos** | De gasto (por categorías/cuentas) o de ahorro (aportaciones reales a cuentas). Periodos semanal/mensual/trimestral/anual/personalizado, alerta configurable, proyección al cierre y consulta de periodos anteriores. |
| **Metas de ahorro** | Aportaciones y retiradas como transferencias reales (sin doble conteo), ritmo medio, aportación mensual necesaria y fecha estimada. Pausar, completar, archivar. |
| **Recurrentes** | Salario, arriendo, facturas, suscripciones. Calendario de próximos movimientos y obligaciones. **Lo previsto nunca se marca solo como pagado**: se registra el importe/fecha reales con un clic (idempotente). |
| **Análisis** | Ingresos vs gastos, evolución del saldo y del ahorro, gastos/ingresos por categoría, comparación con el periodo anterior, flujo entre cuentas, cumplimiento de presupuestos y metas. Cada gráfico tiene vista de tabla y permite ver los movimientos que lo componen. Recomendaciones con su **base declarada**; si no hay historial suficiente, lo dice. Simulador de recortes y calculadora de ahorro necesario. |
| **Datos** | Exportación JSON (reimportable), CSV y **SQL** (SQLite). **Importación universal** (ver abajo) de CSV, TSV, Excel, JSON, volcados SQL y bases SQLite —incluidas las copias de **Cashew**— con validación fila a fila; la copia JSON propia se restaura de forma atómica (todo o nada). El SQL importado **nunca se ejecuta**: se analiza como texto. |

### Etiquetas financieras y finalidades

Cada presupuesto y meta de ahorro tiene una **etiqueta obligatoria** (`#Ordenador`, `#ViajeJapon`, `#Alimentacion`), generada del nombre o personalizada. Pestaña **Finalidades**: destino de los ingresos del periodo (incluido lo **sin asignar**) y, por etiqueta, ingresos y gastos vinculados, asignado, utilizado, pendiente, % de cumplimiento, historial y evolución.

| Concepto | Responde a | Ejemplo |
| :--- | :--- | :--- |
| **Categoría** | ¿en qué se gastó / de dónde vino? | Compras |
| **Etiqueta financiera** | ¿para qué finalidad? | #Ordenador |
| **Cuenta** | ¿dónde está el dinero? | Banco |

*   **Asignación opcional y explícita**: un movimiento se puede repartir entre varias finalidades (salario de 2.000 → 500 a #Ordenador, 300 a #ViajeJapon, 200 a #Emergencias, 1.000 sin asignar). Nada se etiqueta solo por categoría, importe o cuenta.
*   **Sin duplicar dinero**: repartir no mueve saldo; la suma de las asignaciones nunca supera el importe (validado en formulario, API, importación, sincronización y con un trigger SQL).
*   **Sentido**: `asignar` (dinero destinado) o `usar` (gastado con cargo a la finalidad). Metas: ahorrado = asignado − usado. Presupuestos de gasto: **solo** los gastos vinculados a su etiqueta (más sus criterios opcionales de categoría/cuenta). Presupuestos de ahorro: solo lo asignado explícitamente.
*   **Sin ambigüedad**: la etiqueta es 1:1 con su dueño y los movimientos la referencian por id (`tag-<dueño>`); dos finalidades activas no pueden compartir nombre.
*   **Historial protegido**: renombrar no altera nada; no se borra un presupuesto/meta con movimientos vinculados (se archiva y conserva su etiqueta); lo archivado no admite asignaciones nuevas.
*   **Sincronización**: las asignaciones viajan dentro del movimiento (resolución atómica: una fusión nunca produce un reparto que supere el importe); si un dispositivo borra una finalidad mientras otro le asigna dinero, se restaura. Los movimientos antiguos con meta (`goalId`) se leen como asignaciones sin reescribirse.
*   **Recurrentes**: plantilla de reparto que se aplica al registrar cada ocurrencia (ids deterministas, nunca asigna más de lo cobrado).
*   **Importación/exportación**: JSON incluye etiquetas; CSV con columna `finalidades` (`#Ordenador=500|#ViajeJapon=300`); SQL con la migración `V2__finance_tags`.

### Importación universal de movimientos

Pestaña **Datos → Importar**: se elige o se arrastra un archivo, se revisa el análisis automático, se resuelven las dudas y se confirma. Todo ocurre en el navegador: ningún dato financiero sale del dispositivo.

**Formatos** (detectados por su **contenido**, no por la extensión; si no coinciden se avisa):

| Formato | Lector | Notas |
| :--- | :--- | :--- |
| CSV / TSV | `import/sources.ts` | Separador `,` `;` tab `\|` o `sep=`; UTF-8, UTF-16 o Windows-1252; repara CSV reenvueltos por Excel. |
| Excel `.xlsx` | `import/xlsx.ts` | ZIP + XML sin dependencias; todas las hojas; fechas por formato de celda; tope anti ZIP-bomba. |
| Excel 97-2003 `.xls` | `import/xls.ts` | Contenedor OLE2 + BIFF8; fórmulas por su último resultado (nunca se evalúan); sistema de fechas 1904; detecta archivos cifrados. |
| JSON | `import/sources.ts` | Listas de objetos (anidadas o varias listas relacionadas: `accountId` → nombre de la cuenta). |
| SQL de texto | `import/sqldump.ts` | Solo `CREATE TABLE` e `INSERT … VALUES` con literales; el resto se ignora y se informa. `sqlite3 .dump` y `mysqldump`. |
| SQLite | `import/sqlite.ts` | Lectura de solo lectura de las páginas del archivo (sin WebAssembly, que la CSP bloquea); claves foráneas → nombres. |
| Cashew | `import/cashew.ts` | Copia `.sql` (SQLite), volcado SQL o CSV (perfil predefinido para sus cabeceras en español/inglés). |

Añadir un formato (OFX, QIF…) = registrar un `ImportReader` con `registerReader`; el resto del sistema no cambia.

**Proceso**

1. **Columnas**: reconocidas por nombre (sinónimos en español, inglés y portugués), por contenido o por un perfil guardado. Las columnas de identificadores (`category_fk`, `wallet_id`…) nunca se toman como nombres: se usan las tablas relacionadas. Lo deducido solo por contenido requiere confirmación.
2. **Normalización** (`import/normalize.ts`): fechas ISO con o sin hora/milisegundos/zona, `DD/MM/AAAA`, `MM/DD/AAAA`, `DD-MM-AAAA`, `AAAA/MM/DD`, nombres de mes, seriales de Excel y timestamps Unix (s, ms, µs); importes con cualquier separador, símbolo o código de moneda, `(1.200)`, `20-`, `CR/DR`. Tipo: columna explícita > marca ingreso/gasto > débito/crédito > signo.
3. **Confirmaciones obligatorias**: fechas ambiguas (`03/04/2026`), separador decimal dudoso (`1.500`), moneda de cuentas nuevas no indicada y columnas deducidas por contenido. Sin respuesta, no se importa.
4. **Validación fila a fila** con tres niveles —*corregido automáticamente*, *advertencia* y *error crítico*— y, por cada incidencia, fila, campo, valor original, problema, solución y estado de resolución. Una fila con error no bloquea las demás.
5. **Decisiones del usuario**: corregir campos desde la vista previa, incluir/excluir filas, asignar cuentas y categorías desconocidas a existentes, crearlas, dejar sin categoría o excluir sus filas.
6. **Duplicados** en tres niveles: *exacto* (mismo id —no se puede forzar— o mismo contenido), *posible* (campos configurables: fecha, cuenta, tipo, importe, concepto, categoría) y *parecido* (mismo importe y cuenta a ±3 días: solo aviso). Lo dudoso se omite por defecto pero se puede importar.
7. **Guardado atómico**: tras un diálogo de confirmación, todo se escribe en una sola operación sobre una copia (`mutate`); si falla (p. ej. sin espacio), no queda nada a medias ni en memoria ni en disco. Ids deterministas: repetir la importación no duplica.
8. **Informe**: resumen de importados, corregidos, omitidos y rechazados; CSV con todas las incidencias y CSV con las filas no importadas (valores originales + motivo) para corregirlas y reimportarlas.

Las preferencias (columnas, formato de fecha y decimales, zona horaria, cuentas/categorías asignadas, criterio de duplicados) se guardan por origen en este dispositivo y se aplican solas la próxima vez.

**Limitaciones conocidas**

*   La app guarda importes con **2 decimales**: importes con más (p. ej. criptomonedas) requieren autorización para redondear, y los que quedarían en 0 se rechazan.
*   Solo se guarda el **día** del movimiento (no la hora); los instantes con zona se convierten según la política elegida (día local del dispositivo o UTC).
*   No se convierten monedas: un movimiento en una moneda distinta a la de su cuenta es un error.
*   Cuentas con monedas que no son códigos ISO de 3 letras (p. ej. `USDT`) no se crean solas: se asignan a una cuenta existente.
*   No se admiten `.ods`, Excel anterior a 97, páginas HTML guardadas como `.xls` ni archivos protegidos con contraseña (se explica cómo convertirlos).
*   De Cashew no se importan presupuestos ni objetivos como entidades (el objetivo queda anotado en la descripción); las transferencias cuya pareja se borró en Cashew entran como correcciones con aviso.
*   La escritura en IndexedDB es una única transacción; si fallara de forma asíncrona, la app muestra el aviso de almacenamiento existente y al recargar se ve el estado anterior completo.

**Decisiones de integridad**

*   Importes en **céntimos enteros** (`lib/money.ts`): sin errores de coma flotante.
*   Los **saldos se derivan** de saldo inicial + movimientos; nunca se guardan. Editar o borrar un movimiento sincronizado no deja saldos desajustados, y dos dispositivos con los mismos movimientos tienen el mismo saldo.
*   Todas las escrituras pasan por `mutate`, que trabaja sobre una copia: si una validación falla a mitad, no se escribe nada.
*   Crear con un id ya existente es **idempotente** (doble clic, reintentos).

**Migraciones**

*   Base local versionada (`localDb.MIGRATIONS`, versión actual 4: crea de forma determinista la etiqueta de cada presupuesto y meta existentes). Antes de migrar se guarda una copia íntegra del JSON previo (`gestion-tareas:db:backup-v<N>`).
*   SQL versionado para el servidor: `server/prisma/migrations/finance/V1__finance.sql` (tablas `fin_*`, CHECKs de signo, claves foráneas e índices) y `V2__finance_tags.sql` (`fin_tags`, `fin_allocations` y trigger de tope), generado desde `client/src/services/finance/sql.ts` con `npm run sql:gen`. Un test comprueba que el fichero y el código coinciden y ejecuta esquema + volcado en SQLite real. Los modelos Prisma equivalentes están en `schema.prisma`. Para aplicar las restricciones CHECK en una base del servidor: `sqlite3 server/prisma/dev.db < server/prisma/migrations/finance/V1__finance.sql`.

---

## 📝 Módulo de Notas

Sección **Notas** (`/notas`, también en la paleta de comandos: «Nueva nota»). Notas con texto enriquecido, categorías y subcategorías, color y símbolo, archivos adjuntos y **cálculos automáticos** dentro del texto.

| Funcionalidad | Detalle |
| :--- | :--- |
| **CRUD** | Crear (título obligatorio; el contenido puede quedar vacío), ver, editar todos los campos, duplicar (id y fechas propias, adjuntos compartidos), archivar/desarchivar y **papelera** (borrado lógico, restaurar, eliminar definitivamente, vaciar). |
| **Organización** | Categorías y subcategorías (un nivel) con color y símbolo. Al borrar una categoría con notas se elige: moverlas a otra, dejarlas sin categoría o enviarlas a la papelera. Las categorías nunca se identifican solo por color (siempre icono + nombre). |
| **Consulta** | Vista de tarjetas o de lista, búsqueda sin tildes en título, descripción, contenido, categorías y nombres de adjuntos; filtros por estado, categoría, subcategoría, fechas y adjuntos; orden por modificación, creación, título o categoría; carga progresiva de 30 en 30. |
| **Editor** | TipTap/ProseMirror: tipografía, tamaño, color (paleta, personalizado o predeterminado), negrita, cursiva, subrayado, tachado, título/subtítulo/sección/cuerpo, listas, alineación, enlaces (solo http(s), mailto, tel), deshacer/rehacer y atajos de teclado. Barra desplazable en el móvil. |
| **Autoguardado** | Agrupa cambios (0,9 s), indicador «Guardado / Guardando / Sin guardar», guarda al salir, al ocultar la pestaña y al cerrarla. Copia de recuperación en `localStorage` que solo se borra cuando la escritura en disco termina: tras un cierre brusco se ofrece **recuperar** los cambios. |
| **Adjuntos** | Varios por nota, arrastrar y soltar, vista previa de imágenes y texto, PDF en pestaña nueva, descarga, renombrar/descripción, reemplazar y quitar. PDF, PNG, JPG, WEBP, GIF, texto (txt, md, csv, json), RTF, Word, Excel, PowerPoint y OpenDocument; ampliable con `registerAttachmentType`. |
| **Exportar** | Markdown, HTML (autónomo y escapado) y texto, con los resultados de los cálculos incluidos. |

### Cálculos automáticos

Al escribir `200+200=` aparece `400` justo después del `=`. Admite `+ - * /` (también `× ÷`), paréntesis, decimales (punto o coma), negativos y porcentaje con una convención fija: **`x%` = `x/100`** (`1500*19%=285`).

*   **Seguro**: analizador propio de descenso recursivo; nunca `eval` ni `Function`. Límites de longitud, cifras y anidación.
*   **Exacto**: fracciones de `BigInt` (`0.1+0.2=0.3`). Solo se redondea al mostrar: automático hasta 10 decimales o un número fijo por nota, redondeo «mitad lejos de cero»; el resultado redondeado se indica.
*   **Sin sorpresas al escribir**: el resultado se dibuja (no se inserta en el texto), así que no se duplica, no mueve el cursor y se actualiza al cambiar la operación sin tocar el resto de la nota. Solo se recalculan los párrafos modificados.
*   **Control del usuario**: clic en el resultado (o `Ctrl/Cmd+Mayús+Intro`) lo fija como texto normal editable; el botón «Fijar resultados» los fija todos; los cálculos se pueden desactivar por nota. Un resultado escrito a mano que no coincide se subraya; una expresión incompleta o con división entre cero se marca con el motivo, nunca con un resultado falso.
*   **No calcula lo que no es un cálculo**: fechas (`26/09/2026`, `2026-09-26`), teléfonos (`300-555-1234`), códigos con ceros a la izquierda (`007`), cifras pegadas a palabras (`abc12+3`) ni comparaciones (`==`, `<=`, `>=`, `!=`).

### Datos, seguridad y sincronización

*   **Modelo** (`localDb.ts`, migración **v5**, solo añade colecciones): `noteCategories` (con `parentId`) y `notes` (título, descripción, contenido JSON, texto derivado para buscar, categoría/subcategoría, color, símbolo, adjuntos, archivado, `deletedAt`, ajustes de cálculo, fechas). Categorías iniciales con ids fijos (dos dispositivos no las duplican).
*   **Contenido** guardado como JSON estructurado (no HTML). `sanitizeDoc` aplica listas blancas de nodos, marcas y atributos (colores `#rrggbb`, tipografías y tamaños permitidos, enlaces seguros) en cada escritura, en las copias de seguridad y en la sincronización: una fila con contenido no saneado se rechaza.
*   **Adjuntos**: el binario va a una base IndexedDB propia (`gestion-tareas-files`), no al JSON de la app, con clave SHA-256 (un mismo archivo en dos notas se guarda una vez y solo se borra cuando ninguna nota, ni de la papelera, lo usa). El tipo se decide por la firma del contenido, no por la extensión ni por el MIME del navegador; se rechazan ejecutables, scripts, HTML y SVG, dobles extensiones engañosas y nombres con rutas o caracteres peligrosos. Al abrir se usa el MIME de la app. Máximo 15 MB por archivo, 60 MB y 30 adjuntos por nota.
*   **Sincronización y copias**: notas y categorías se sincronizan entre dispositivos y entran en la copia JSON con las mismas validaciones.

**Limitaciones conocidas**

*   Los **binarios de los adjuntos no se sincronizan ni van en la copia JSON** (solo sus datos): en otro dispositivo aparecen como «no disponible en este dispositivo». Sincronizar binarios requeriría ampliar el protocolo de sincronización.
*   El PDF se abre en el visor del navegador (pestaña nueva); los documentos de Office se descargan (no hay visor integrado). La exportación a PDF se hace imprimiendo el HTML exportado.
*   La sincronización resuelve conflictos por nota completa: si la misma nota se edita a la vez en dos dispositivos, se elige una versión (no se fusionan párrafos).
*   Separador de miles no admitido en los cálculos: `1.500` se lee como 1,5 (se recomienda escribir `1500`).

---

## 🔁 Hábitos: metas, horarios, Google Calendar y capturas

### Metas cuantificables
*   Cada hábito distingue **meta diaria** (`dailyTarget`, con unidad opcional: «vasos», «min»…) y **veces realizadas** (`count` del registro del día). Meta 1: un clic lo completa (como siempre). Meta > 1: cada clic suma una; **−** corrige un clic de más y el lápiz fija la cantidad a mano. La barra se detiene en 100 % pero se guarda el total real.
*   Cada registro diario guarda la **meta vigente ese día** (`target`): cambiar la meta no reescribe días pasados. Los registros de versiones anteriores (sin `target`) se siguen leyendo como cumplidos, igual que antes.
*   Toda operación queda **trazada** en el registro (`trail`: inc/dec/set, origen manual/calendario/panel/importación).
*   Un día cuenta para la racha y el % de éxito solo si alcanzó su meta. La racha no se rompe mientras el día de hoy siga abierto.

### Programación (`habitSchedules`)
*   Se guardan **reglas**, no eventos: horario único, recurrente (diario, semanal con días elegidos, mensual; «cada N»), con fecha de inicio/fin opcional y **zona horaria** (IANA, con cambios de horario de verano). Varias horas al día = varias reglas, editables por separado.
*   Las ocurrencias se calculan al vuelo para el rango visible (`GET /habits/calendar`): sin duplicados ni eventos futuros acumulados.
*   Cambiar la hora de una regla ya empezada la **parte en dos** (la antigua acaba ayer, la nueva empieza hoy): los días pasados siguen mostrando lo previsto entonces. Desactivar corta solo las ocurrencias futuras.

### Calendario interno
*   Los horarios aparecen solos en el calendario con color, símbolo, ↻ de recurrencia y estado: **programado, pendiente, en curso, completado, parcial, incumplido**. Con varias franjas al día, la meta se reparte (8 vasos en 8 horas: la franja k se completa al llegar a k+1).
*   Pulsar un evento abre el registro rápido del día. **Aparecer en el calendario nunca cuenta como hecho.**

### Google Calendar (opcional)
*   OAuth 2.0 con Google Identity Services (modelo de token, sin servidor ni client secret). El token solo vive **en memoria** (~1 h) y se revoca al desconectar; nunca se guarda ni se registra.
*   Permisos mínimos: modo recomendado `calendar.app.created` (la app crea y gestiona solo su calendario «Hábitos»); o `calendar.events.owned` + `calendar.calendarlist.readonly` para elegir uno de tus calendarios. Nunca correo ni contactos.
*   Un evento por regla (los recurrentes con **una RRULE**). Ids de evento **deterministas** y vínculos (`gcalLinks`) sincronizados entre dispositivos: repetir la sincronización, reintentar tras un corte de red o sincronizar desde el PC y el móvil **no duplica** eventos. Solo se tocan eventos con la marca privada de la app.
*   Detección a tres bandas: cambios solo locales se envían (con `If-Match`); cambios hechos en Google se **preguntan** o se aplican solos (según preferencia); si cambian ambos lados es un **conflicto** que decide el usuario. Eventos borrados en Google no se recrean solos. Al quitar un horario se puede retirar el evento futuro de Google conservando las ocurrencias pasadas.
*   Reintentos con espera exponencial para red/429/5xx; errores de autorización, permisos y conflictos se muestran en Configuración › Integraciones sin perder datos locales.

**Configuración necesaria (una vez):**
1. En [Google Cloud Console](https://console.cloud.google.com/): crea un proyecto, habilita **Google Calendar API** y configura la pantalla de consentimiento OAuth (añade los scopes anteriores; en modo «prueba», añade tu cuenta como usuario de prueba).
2. Crea un **ID de cliente OAuth → Aplicación web** con los **orígenes JavaScript autorizados** donde se sirve la app (p. ej. `https://task-gestor.netlify.app`, `http://localhost:5173`). No hace falta URI de redirección.
3. Define `VITE_GOOGLE_CLIENT_ID` al compilar (`client/.env`, ver `client/.env.example`, o variable de entorno en Netlify), o pégalo en Configuración › Integraciones.

### Importar desde una captura de calendario
*   En Hábitos → «Importar desde captura»: elegir o arrastrar PNG/JPG (≤ 10 MB, tipo verificado por firma), recortar, confirmar la fecha y la vista, y analizar.
*   OCR **local** con Tesseract.js (español + inglés): la imagen **no sale del dispositivo** ni se guarda (solo una huella SHA-256 para detectar reimportaciones). La primera vez se descarga el motor desde `cdn.jsdelivr.net`, con aviso y consentimiento previo.
*   Además de leer la página completa, detecta los **bloques de color** de cada evento y los lee por separado (recuperando texto blanco sobre fondos oscuros). Entiende vistas de día, semana y agenda; horas en 12 h/24 h; fechas partidas o mal leídas se recuperan solo si el número de día visible lo confirma. Lo ilegible se deja vacío y se marca para confirmar: **no se inventan datos**.
*   Cada evento se propone asociado a un hábito (sinónimos y tolerancia a errores de OCR; con varias coincidencias hay que elegir). Por defecto solo «estaba programado»: registrar una realización exige elegir «Lo realicé» y confirmar. Reimportar la misma captura no duplica nada.

---

## 📱 iPhone, almacenamiento y actualizaciones

*   **Datos locales en IndexedDB** (antes localStorage, limitado a ~5 MB): la primera apertura migra los datos existentes y deja la copia antigua intacta. Se solicita almacenamiento persistente.
*   **Varias pestañas sin pérdida de datos**: cada escritura lleva una revisión; si otra pestaña guardó entre medias, se fusiona fila a fila (nunca se sobrescribe la base entera) y las demás pestañas recargan solas. *Causa del fallo corregido: cada pestaña guardaba su copia completa y una pestaña antigua —incluso sin tocarla, al avisar de un recordatorio— borraba lo guardado en otra.*
*   **Copia espejo en localStorage** (si los datos caben, ~4 MB): se actualiza tras cada guardado y de forma síncrona al salir de la página; al arrancar se usa la copia más reciente y verificada (suma de comprobación). Si la base principal aparece vacía, se recupera del espejo o de la última copia verificada antes que empezar de cero.
*   **Indicador de guardado** en la barra superior («Guardando…», «Guardado», «Error al guardar») con reintentos; si falla, aviso con **descarga de emergencia** desde la memoria.
*   **Copias de seguridad y restauración** (Configuración, con acceso directo arriba de la página y en Ctrl+K): copias verificadas automáticas (cada N minutos de uso, solo si hubo cambios, retención configurable) y **antes de acciones destructivas** (borrados en cascada, vaciar papelera, importaciones, restauraciones, migraciones); descarga en JSON (esquema, metadatos, suma de comprobación, adjuntos opcionales en base64, cifrado AES-256-GCM opcional); restauración con validación, vista previa, copia previa obligatoria y modo **reemplazar** o **combinar sin borrar**; recordatorio configurable para descargar una copia externa.
*   Los adjuntos de notas ya **no se borran automáticamente**: solo con «Liberar espacio de adjuntos sin usar», que respeta las copias guardadas y los de menos de 7 días.
*   *Límite honesto*: ningún navegador garantiza conservar sus datos (limpieza del sitio, modo incógnito, falta de espacio o, en Safari fuera de la app instalada, 7 días sin uso). La protección real es instalar la app y descargar copias con regularidad.
*   **Puntos de restauración automáticos** antes de migrar, sincronizar o restaurar; **copias de seguridad cifradas** exportables e importables (Sincronización → Copias de seguridad).
*   **Actualizaciones**: el Service Worker precarga todos los ficheros (offline completo). Una versión nueva no se activa sola: la app muestra «Hay una versión nueva» y al aceptar guarda los datos pendientes y recarga. Actualizar el código no toca los datos; si su formato cambia, se migran con copia previa.
*   **PC**: `npm run pc` compila y sirve la app en `http://localhost:4181` con sus propios datos. Instrucciones completas de instalación, emparejamiento y sincronización en [`sync/README.md`](sync/README.md).

---

## 🧪 Pruebas

```bash
npm test                 # cliente (Vitest) + relé de sincronización (node:test)
npm run test -w client   # solo el cliente
```

La batería del cliente (475 pruebas) cubre reglas de negocio (fechas, obligatorios, precondiciones), restauración entre dispositivos y detección de cifrado, persistencia (pestañas, espejo, recuperación, cuota llena), copias de seguridad, dinero, finanzas, notas, sincronización manual (incluida por red), IndexedDB, cifrado, tareas, migraciones, hábitos (metas, horarios, calendario), Google Calendar (API simulada) y OCR de capturas.

Las reglas de negocio (fechas coherentes, campos obligatorios, precondiciones y códigos de error) están documentadas en [`REGLAS_DE_NEGOCIO.md`](REGLAS_DE_NEGOCIO.md).

---

## ⌨️ Scripts disponibles

Todos se ejecutan desde la **raíz del proyecto**:

| Comando | Descripción |
| :--- | :--- |
| `npm run dev` | Servidor de desarrollo de Vite en `http://localhost:5173`. |
| `npm run build` | Compila y empaqueta el cliente para producción (`client/dist`). |
| `npm run preview` | Sirve localmente el build de producción. |
| `npm test` | Pruebas del cliente y del relé de sincronización. |
| `npm run pc` | Compila la app y la sirve junto al relé de sincronización en `http://localhost:4181`. |
| `npm run sync` | Arranca solo el relé de sincronización PC ↔ móvil. |
| `npm run desktop:dev` | App de escritorio (Tauri) con recarga en caliente. |
| `npm run desktop:build` | Build de escritorio + instalador NSIS para Windows. |
| `npm run sql:gen` | Regenera las migraciones SQL versionadas de finanzas. |
| `npm run dev:server` | *(Backend de referencia)* Arranca Express en `http://localhost:4000`. |
| `npm run build:server` / `npm run start:server` | *(Backend de referencia)* Compila a `server/dist` / ejecuta el build. |
| `npm run db:setup` | *(Backend de referencia)* Genera el cliente Prisma, crea `server/prisma/dev.db` y carga datos de ejemplo. |
| `npm run db:studio` | *(Backend de referencia)* Abre Prisma Studio (`localhost:5555`). |
| `npm run db:seed` | *(Backend de referencia)* Vuelve a cargar los datos de ejemplo. |
| `npm run db:reset` | ⚠️ *(Backend de referencia)* Borra todos los datos de SQLite, recrea el esquema y carga la semilla. |

---

## 📡 Referencia de la API

La capa de datos expone rutas con forma REST. En la app se resuelven **en el navegador** mediante `localApi.ts`; el backend de referencia (`server/src/routes/`) implementa el núcleo de estas rutas bajo el prefijo `/api`.

| Recurso | Rutas principales |
| :--- | :--- |
| **Tareas** `/tasks` | `GET` lista (con categoría, etiquetas y recordatorios) · `GET /:id` · `POST` crear · `PUT /:id` actualizar · `DELETE /:id` eliminar · `PATCH /reorder` ordenar · `/:id/subtasks` subtareas |
| **Hábitos** `/habits` | `GET` lista con registros · `POST` crear · `PUT /:id` · `DELETE /:id` · `POST` / `DELETE /:id/logs` registrar o deshacer el día · `GET /:id/heatmap` · `GET /calendar` ocurrencias de horarios |
| **Objetivos** `/goals` | `GET` metas con progreso calculado · `POST` crear · `PUT /:id` actualizar · `DELETE /:id` |
| **Eventos** `/events` | `GET` por rango de fechas · `POST` crear · `PUT /:id` · `DELETE /:id` |
| **Estadísticas** `/stats/summary` | Agregados del dashboard y series temporales de 30 días |
| **Respaldo** `/backup` | `GET /export` copia completa en JSON · `POST /import` restauración |
| **Configuración** `/settings` | `GET` / `PUT` preferencias · `POST` / `DELETE /settings/pin` y `POST /settings/pin/verify` para el bloqueo por PIN |

Las validaciones y los códigos de error de cada ruta están en [`REGLAS_DE_NEGOCIO.md`](REGLAS_DE_NEGOCIO.md).

---

## 🛡️ Seguridad y respaldos

### Copias de seguridad
*   **Automáticas y verificadas** (suma de comprobación) cada cierto tiempo de uso y **antes de cualquier acción destructiva**.
*   **Descarga manual** en JSON desde Configuración (acceso rápido con `Ctrl+K`), con **cifrado AES-256-GCM** opcional y adjuntos opcionales.
*   **Restauración** con validación, vista previa, copia previa obligatoria y modo *reemplazar* o *combinar sin borrar*.
*   Recomendación: instala la app (PWA o escritorio) y descarga copias externas con regularidad; ningún navegador garantiza conservar sus datos para siempre.

### Bloqueo por PIN
El PIN se guarda solo como hash **PBKDF2** con sal (los PIN antiguos en SHA-256 se vuelven a sellar con PBKDF2 tras el siguiente acierto). Al ser una app 100 % estática, el PIN es un **bloqueo de la interfaz** frente a miradas indiscretas, no un cifrado de los datos: para proteger la información, usa las copias cifradas y el bloqueo del propio dispositivo.

### Despliegue
`netlify.toml` aplica cabeceras de seguridad a todo el sitio (Content Security Policy estricta, entre otras), que en una SPA estática son la principal capa de defensa.

### Backend de referencia
Si usas `server/`, puedes respaldar la base SQLite copiando el archivo:

```bash
cp server/prisma/dev.db backup-$(date +%F).db                                         # Linux / macOS
Copy-Item "server/prisma/dev.db" -Destination "backup-$(Get-Date -Format 'yyyy-MM-dd').db"   # PowerShell
```

---

## 📚 Documentación adicional

| Documento | Contenido |
| :--- | :--- |
| [`DESKTOP.md`](DESKTOP.md) | Compilación e instalación de la app de escritorio para Windows (Tauri 2). |
| [`sync/README.md`](sync/README.md) | Instalación en PC, emparejamiento y sincronización manual con el iPhone. |
| [`REGLAS_DE_NEGOCIO.md`](REGLAS_DE_NEGOCIO.md) | Reglas de negocio, validaciones y códigos de error. |
