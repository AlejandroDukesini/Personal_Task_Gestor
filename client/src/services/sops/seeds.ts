/**
 * Plantillas SOP iniciales. Ids FIJOS en todos los niveles y marca antigua:
 * si dos dispositivos las siembran, las filas coinciden en vez de duplicarse
 * (mismo criterio que el resto de semillas, ver `SEED_STAMP`).
 *
 * Solo importa tipos de `localDb` (que importa este módulo al migrar).
 */

import type { SopRow, WfActivity, WfStage } from "@/services/localDb";

const TS = "2000-01-01T00:00:00.000Z";

interface StageSeed {
  title: string;
  objective: string;
  procedures: [string, string][];
  activities: string[];
  checklist: string[];
  documentation?: string;
}

function build(prefix: string, seeds: StageSeed[]): WfStage[] {
  return seeds.map((s, i) => {
    const sid = `${prefix}-s${i + 1}`;
    return {
      id: sid,
      title: s.title,
      subtitle: null,
      description: null,
      objective: s.objective,
      color: null,
      startDate: null,
      endDate: null,
      priority: null,
      status: null,
      progress: 0,
      procedures: s.procedures.map(([title, instructions], j) => ({ id: `${sid}-p${j + 1}`, title, instructions, observations: null, checklist: [], createdAt: TS, updatedAt: TS })),
      activities: s.activities.map(
        (title, j): WfActivity => ({ id: `${sid}-a${j + 1}`, title, description: null, dueDate: null, priority: "medium", status: "pending", progress: null, observations: null, checklist: [], dependsOn: [], completedAt: null, createdAt: TS, updatedAt: TS })
      ),
      checklist: s.checklist.map((text, j) => ({ id: `${sid}-c${j + 1}`, text, done: false })),
      documentation: s.documentation ?? null,
      observations: null,
      createdAt: TS,
      updatedAt: TS,
    };
  });
}

const SOFTWARE: StageSeed[] = [
  {
    title: "Análisis y levantamiento de requisitos",
    objective: "Entender el problema, a los usuarios y lo que el sistema debe hacer.",
    procedures: [
      ["Entrevistas con interesados", "1. Identificar a los interesados.\n2. Preparar preguntas abiertas.\n3. Registrar necesidades, restricciones y criterios de éxito."],
      ["Especificación de requisitos", "Redactar requisitos funcionales y no funcionales con criterios de aceptación verificables."],
    ],
    activities: ["Identificar interesados", "Realizar entrevistas", "Redactar documento de requisitos", "Validar requisitos con el cliente"],
    checklist: ["Requisitos funcionales documentados", "Requisitos no funcionales documentados", "Criterios de aceptación acordados"],
    documentation: "- Documento de requisitos\n- Actas de reuniones",
  },
  {
    title: "Planificación",
    objective: "Definir alcance, cronograma, recursos y riesgos.",
    procedures: [["Plan del proyecto", "Desglosar el trabajo, estimar esfuerzo, fijar hitos y responsables."]],
    activities: ["Definir alcance y entregables", "Estimar tiempos", "Elaborar cronograma", "Identificar riesgos"],
    checklist: ["Cronograma aprobado", "Riesgos con plan de mitigación"],
  },
  {
    title: "Diseño y arquitectura",
    objective: "Diseñar la solución técnica y la experiencia de usuario.",
    procedures: [
      ["Diseño de arquitectura", "Elegir componentes, tecnologías e integraciones; documentar decisiones (ADR)."],
      ["Diseño de interfaz", "Prototipos de baja y alta fidelidad validados con usuarios."],
    ],
    activities: ["Diagrama de arquitectura", "Modelo de datos", "Prototipo de interfaz"],
    checklist: ["Arquitectura revisada", "Modelo de datos aprobado"],
  },
  {
    title: "Desarrollo",
    objective: "Construir la solución de forma incremental y con calidad.",
    procedures: [["Flujo de trabajo con Git", "Rama por funcionalidad, revisiones de código y commits descriptivos."]],
    activities: ["Configurar repositorio y entorno", "Implementar funcionalidades", "Revisiones de código"],
    checklist: ["Código revisado", "Sin errores de compilación"],
  },
  {
    title: "Pruebas y validación",
    objective: "Verificar que la solución cumple los requisitos.",
    procedures: [["Plan de pruebas", "Pruebas unitarias, de integración y de aceptación con casos documentados."]],
    activities: ["Pruebas unitarias", "Pruebas de integración", "Pruebas de aceptación con el usuario"],
    checklist: ["Casos de prueba ejecutados", "Defectos críticos corregidos"],
  },
  {
    title: "Seguridad",
    objective: "Reducir riesgos de seguridad antes de publicar.",
    procedures: [["Revisión de seguridad", "Revisar autenticación, permisos, validación de entradas, secretos y dependencias."]],
    activities: ["Auditoría de dependencias", "Revisión de permisos y datos sensibles"],
    checklist: ["Sin secretos en el repositorio", "Dependencias sin vulnerabilidades conocidas"],
  },
  {
    title: "Despliegue",
    objective: "Publicar la solución de forma segura y reversible.",
    procedures: [["Puesta en producción", "Preparar entorno, copia de seguridad, despliegue y plan de reversión."]],
    activities: ["Preparar entorno de producción", "Desplegar", "Verificar tras el despliegue"],
    checklist: ["Copia de seguridad previa", "Plan de reversión probado"],
  },
  {
    title: "Documentación y entrega",
    objective: "Entregar la solución con todo lo necesario para usarla y mantenerla.",
    procedures: [["Entrega al cliente", "Manual de usuario, documentación técnica y acta de entrega."]],
    activities: ["Manual de usuario", "Documentación técnica", "Capacitación", "Acta de entrega"],
    checklist: ["Documentación entregada", "Acta firmada"],
  },
  {
    title: "Mantenimiento",
    objective: "Dar soporte, corregir errores y evolucionar la solución.",
    procedures: [["Gestión de incidencias", "Registrar, priorizar, corregir y comunicar cada incidencia."]],
    activities: ["Monitoreo", "Corrección de errores", "Mejoras planificadas"],
    checklist: ["Canal de soporte definido"],
  },
];

const RESEARCH: StageSeed[] = [
  {
    title: "Planteamiento del problema",
    objective: "Delimitar la pregunta de investigación y su justificación.",
    procedures: [["Formulación", "Redactar problema, pregunta, objetivos general y específicos, y justificación."]],
    activities: ["Definir pregunta de investigación", "Redactar objetivos"],
    checklist: ["Pregunta clara y delimitada"],
  },
  {
    title: "Marco teórico",
    objective: "Revisar lo que ya se sabe sobre el tema.",
    procedures: [["Revisión bibliográfica", "Buscar en bases de datos, fichar fuentes y sintetizar antecedentes."]],
    activities: ["Búsqueda de fuentes", "Fichas de lectura", "Redactar marco teórico"],
    checklist: ["Fuentes citadas correctamente"],
  },
  {
    title: "Metodología",
    objective: "Definir cómo se obtendrán y analizarán los datos.",
    procedures: [["Diseño metodológico", "Enfoque, población, muestra, instrumentos y procedimiento de análisis."]],
    activities: ["Diseñar instrumentos", "Validar instrumentos"],
    checklist: ["Instrumentos validados"],
  },
  {
    title: "Recolección y análisis",
    objective: "Obtener los datos y analizarlos.",
    procedures: [["Trabajo de campo", "Aplicar instrumentos y registrar los datos de forma ordenada."]],
    activities: ["Aplicar instrumentos", "Analizar datos"],
    checklist: ["Datos respaldados"],
  },
  {
    title: "Resultados y conclusiones",
    objective: "Comunicar hallazgos y conclusiones.",
    procedures: [["Informe final", "Resultados, discusión, conclusiones, recomendaciones y referencias."]],
    activities: ["Redactar resultados", "Redactar conclusiones", "Revisión final"],
    checklist: ["Normas de citación revisadas"],
  },
];

export function defaultSopTemplates(): SopRow[] {
  return [
    {
      id: "sop-tpl-software",
      kind: "template",
      name: "Desarrollo de software",
      description: "Ciclo completo de un proyecto de software, desde los requisitos hasta el mantenimiento.",
      objective: "Entregar software que cumple los requisitos, probado, seguro y documentado.",
      category: "Tecnología",
      version: "1.0",
      status: "active",
      owner: null,
      color: "#6366f1",
      stages: build("sop-tpl-software", SOFTWARE),
      createdAt: TS,
      updatedAt: TS,
    },
    {
      id: "sop-tpl-research",
      kind: "template",
      name: "Proyecto de investigación",
      description: "Estructura para trabajos de investigación académicos o profesionales.",
      objective: "Responder una pregunta de investigación con un método riguroso.",
      category: "Académico",
      version: "1.0",
      status: "active",
      owner: null,
      color: "#0ea5e9",
      stages: build("sop-tpl-research", RESEARCH),
      createdAt: TS,
      updatedAt: TS,
    },
  ];
}
