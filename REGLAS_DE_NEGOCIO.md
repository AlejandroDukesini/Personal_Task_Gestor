# Reglas de negocio

Este documento describe las reglas que la aplicación **hace cumplir realmente**.

- **Autoridad final:** la API local (`client/src/services/localApi.ts` y `client/src/services/finance/routes.ts`). Todas las páginas pasan por ella, así que una petición que incumpla una regla se rechaza **antes de escribir nada**, venga del formulario o de una llamada directa.
- **Definición única:** las reglas del núcleo viven en `client/src/services/rules.ts`. La API las usa para rechazar y los formularios para avisar antes de enviar.
- **Servidor Express (`server/`):** es heredado y el cliente no lo usa. Aplica las mismas reglas de fechas, campos obligatorios y categorías (`server/src/lib/rules.ts`).
- **Pruebas:** `client/src/services/rules.test.ts`.

## Códigos de error

| Código | Cuándo | Ejemplo de mensaje |
| --- | --- | --- |
| 400 | Dato inválido: formato, campo obligatorio, orden de fechas | «La fecha de fin debe ser posterior a la de inicio.» |
| 404 | El registro o la referencia no existe | «Categoría no encontrada» |
| 409 | El estado actual impide la operación | «Completa los sub-pasos pendientes antes de cerrar la tarea (1 de 2 hechos).» |

## Fechas

Las fechas sin hora se guardan como medianoche UTC del día elegido y se comparan **por día**.

| Entidad | Regla | ¿Mismo día? |
| --- | --- | --- |
| Tarea | inicio ≤ vencimiento | Permitido |
| Tarea | una hora (`HH:mm`) exige fecha de vencimiento | — |
| Tarea | un recordatorio exige fecha de vencimiento | — |
| Evento | fin **>** inicio (instantes con hora) | Rechazado: un evento ocupa un intervalo |
| Objetivo | fecha límite ≥ inicio | Permitido (objetivo diario) |
| Objetivo | al **crearlo**, la fecha límite no puede estar en el pasado. Editar objetivos antiguos sigue permitido | — |
| Hábito | fin ≥ inicio | Permitido |
| Registro de hábito | no se registra un día que aún no ha llegado (día local) | Hoy está permitido |

Reglas que ya existían y se mantienen: presupuestos, metas de ahorro, recurrentes y horarios de hábitos (fin ≥ inicio, hora fin > hora inicio).

- **Formato:** una fecha ilegible devuelve 400 «…: fecha no válida». Antes rompía con un `RangeError`.
- **Actualizaciones parciales (PUT):** se valida la fila **resultante**, no solo lo enviado. Solo se revisan las reglas de los campos que llegan, para que una fila antigua pueda seguir cambiando de estado.
- **Zona horaria:**
  - El formulario de eventos muestra y guarda la hora **local**.
  - El inicio por defecto de un objetivo es el día local.
  - Al arrastrar una tarea en el calendario se guarda el día local (y la hora, si cae en una franja horaria).

## Campos obligatorios

El texto se recorta. Un valor null, vacío o de solo espacios se rechaza.

| Entidad | Obligatorio | Máx. |
| --- | --- | --- |
| Tarea | título | 200 |
| Sub-paso | título | 200 |
| Evento | título, inicio, fin | 200 |
| Objetivo | título, fecha límite; meta > 0 | 200 |
| Hábito | nombre; con frecuencia «personalizada», al menos un día (0–6) | 120 |
| Categoría | nombre | 80 |
| Etiqueta | nombre, único sin distinguir mayúsculas ni espacios | 60 |

La descripción, las notas, la unidad, la categoría y las etiquetas siguen siendo opcionales.

## Relaciones

- Las categorías, etiquetas y objetivos de una tarea, y la categoría de un hábito, evento u objetivo, deben existir (404).
- Un recordatorio debe apuntar a una tarea, hábito o evento existente.
- **Categorías:** hay un solo nivel. El padre debe existir y ser una categoría principal, y no puede ser la propia categoría. Una categoría con subcategorías no puede convertirse en subcategoría (409).
- Un objetivo con origen «finanzas» exige una meta de ahorro.

## Precondiciones de operaciones

| Operación | Precondición | Si no se cumple |
| --- | --- | --- |
| Completar una tarea (formulario, casilla, Kanban) | todos sus sub-pasos hechos | 409; el lote del Kanban se descarta entero |
| Registrar un hábito | no archivado; día no futuro | 409 / 400 |
| Aportar a una meta de ahorro | meta `active` | 409 |
| Retirar de una meta de ahorro | meta no archivada; importe ≤ lo ahorrado | 409 |

## Estados de tareas

`pending` · `in_progress` · `completed` · `cancelled`.

No se impone una máquina de estados rígida. El Kanban permite mover tareas entre todas las columnas y el dominio no define transiciones prohibidas. Lo que sí se garantiza:

- Pasar a `completed` exige el checklist completo.
- Marcar el último sub-paso cierra la tarea y desmarcar uno la reabre (salvo si está `cancelled`).
- `completedAt` solo existe en `completed` y no se reescribe al volver a guardar.
- Completar una tarea recurrente crea la siguiente una sola vez.

## Cambios de comportamiento

| Antes | Después | Motivo |
| --- | --- | --- |
| Se podía completar una tarea con sub-pasos pendientes (quedaba «completada al 40 %») | Se rechaza con 409 | El checklist es la fuente de verdad del progreso |
| Se aceptaban títulos de solo espacios | Se rechazan | Registros sin nombre identificable |
| Etiquetas «Trabajo» y «trabajo» convivían | 409 | Serían indistinguibles al filtrar |
| Recordatorio sin vencimiento: se ignoraba en silencio | 400 con mensaje | El usuario creía tenerlo programado |
| La API permitía aportar a metas pausadas o archivadas y retirar más de lo ahorrado (la UI lo ocultaba) | 409 | El backend es la autoridad |

## Pendientes conocidos

- Importar una copia de seguridad y sincronizar aceptan filas de tareas, eventos y objetivos sin estas reglas, para no rechazar copias antiguas. Las filas financieras y de notas sí se validan.
