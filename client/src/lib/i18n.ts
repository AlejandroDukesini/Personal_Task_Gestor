import { useConfig } from "@/store/config";

type Dict = Record<string, string>;

const es: Dict = {
  // Navegación
  "nav.dashboard": "Dashboard",
  "nav.tasks": "Tareas",
  "nav.habits": "Hábitos",
  "nav.calendar": "Calendario",
  "nav.categories": "Categorías",
  "nav.tags": "Etiquetas",
  "nav.goals": "Objetivos",
  "nav.stats": "Estadísticas",
  "nav.settings": "Configuración",
  "nav.localData": "datos locales",
  "nav.openMenu": "Abrir menú",

  // Saludo
  "greeting.morning": "Buenos días",
  "greeting.afternoon": "Buenas tardes",
  "greeting.evening": "Buenas noches",

  // Dashboard
  "dash.completedToday": "Hoy completadas",
  "dash.pending": "Pendientes",
  "dash.activeHabits": "Hábitos activos",
  "dash.week": "Semana",
  "dash.productivity": "Productividad (últimos 30 días)",
  "dash.habitsWeek": "Hábitos esta semana",
  "dash.pendingTasks": "Tareas pendientes",
  "dash.seeAll": "Ver todas",
  "dash.see": "Ver",
  "dash.noPending": "No hay tareas pendientes ✨",
  "dash.habitsToday": "Hábitos hoy",
  "dash.noHabits": "Sin hábitos",
  "dash.upcomingEvents": "Próximos eventos",
  "dash.noEvents": "Sin eventos próximos",
  "dash.goalsProgress": "Progreso de objetivos",
  "dash.seeAllM": "Ver todos",
  "dash.noGoals": "Sin objetivos definidos",

  // Configuración
  "settings.title": "Configuración",
  "settings.subtitle": "Personaliza la app y gestiona tus datos.",
  "settings.appearance": "Apariencia",
  "settings.theme": "Tema",
  "settings.themeLight": "Claro",
  "settings.themeDark": "Oscuro",
  "settings.themeSystem": "Sistema",
  "settings.primaryColor": "Color primario",
  "settings.fontSize": "Tamaño de fuente: {value}%",
  "settings.langFormat": "Idioma y formato",
  "settings.language": "Idioma",
  "settings.dateFormat": "Formato de fecha",
  "settings.timezone": "Zona horaria",
  "settings.security": "Seguridad",
  "settings.pinHelp":
    "Protege el acceso a tu app con un PIN local. Se guarda como hash en tu base de datos local.",
  "settings.removePin": "Eliminar PIN actual",
  "settings.newPin": "Nuevo PIN (4+ dígitos)",
  "settings.savePin": "Guardar PIN",
  "settings.generatePin": "Generar",
  "settings.data": "Datos",
  "settings.dataHelp": "Exporta una copia de seguridad o importa datos desde otro backup.",
  "settings.exportJson": "Exportar JSON",
  "settings.exportCsv": "Exportar CSV",
  "settings.importJson": "Importar JSON",

  // Perfil y marca
  "brand.title": "Perfil y marca",
  "brand.help": "Personaliza el nombre, el logo y tu nombre de usuario del saludo.",
  "brand.appName": "Nombre del programa",
  "brand.appNamePlaceholder": "Productividad",
  "brand.logo": "Logo (emoji o una letra)",
  "brand.logoPlaceholder": "P",
  "brand.logoImage": "Subir imagen de logo",
  "brand.logoReset": "Quitar imagen",
  "brand.userName": "Tu nombre (saludo)",
  "brand.userNamePlaceholder": "Ej: Santiago",
  "brand.save": "Guardar",

  // Bloqueo por PIN
  "lock.title": "App bloqueada",
  "lock.subtitle": "Ingresa tu PIN para continuar",
  "lock.placeholder": "PIN",
  "lock.unlock": "Desbloquear",
  "lock.wrong": "PIN incorrecto",

  // Toasts / comunes
  "toast.saved": "Guardado",
  "toast.pinSaved": "PIN guardado",
  "toast.pinRemoved": "PIN eliminado",
  "toast.pinMin": "Mínimo 4 dígitos",
  "toast.exported": "Exportado",
  "toast.imported": "Importado correctamente",
  "toast.pinGenerated": "PIN generado: {pin} — guárdalo",
  "common.save": "Guardar",
};

const en: Dict = {
  "nav.dashboard": "Dashboard",
  "nav.tasks": "Tasks",
  "nav.habits": "Habits",
  "nav.calendar": "Calendar",
  "nav.categories": "Categories",
  "nav.tags": "Tags",
  "nav.goals": "Goals",
  "nav.stats": "Statistics",
  "nav.settings": "Settings",
  "nav.localData": "local data",
  "nav.openMenu": "Open menu",

  "greeting.morning": "Good morning",
  "greeting.afternoon": "Good afternoon",
  "greeting.evening": "Good evening",

  "dash.completedToday": "Completed today",
  "dash.pending": "Pending",
  "dash.activeHabits": "Active habits",
  "dash.week": "Week",
  "dash.productivity": "Productivity (last 30 days)",
  "dash.habitsWeek": "Habits this week",
  "dash.pendingTasks": "Pending tasks",
  "dash.seeAll": "See all",
  "dash.see": "See",
  "dash.noPending": "No pending tasks ✨",
  "dash.habitsToday": "Habits today",
  "dash.noHabits": "No habits",
  "dash.upcomingEvents": "Upcoming events",
  "dash.noEvents": "No upcoming events",
  "dash.goalsProgress": "Goals progress",
  "dash.seeAllM": "See all",
  "dash.noGoals": "No goals defined",

  "settings.title": "Settings",
  "settings.subtitle": "Customize the app and manage your data.",
  "settings.appearance": "Appearance",
  "settings.theme": "Theme",
  "settings.themeLight": "Light",
  "settings.themeDark": "Dark",
  "settings.themeSystem": "System",
  "settings.primaryColor": "Primary color",
  "settings.fontSize": "Font size: {value}%",
  "settings.langFormat": "Language & format",
  "settings.language": "Language",
  "settings.dateFormat": "Date format",
  "settings.timezone": "Time zone",
  "settings.security": "Security",
  "settings.pinHelp":
    "Protect access to your app with a local PIN. It is stored as a hash in your local database.",
  "settings.removePin": "Remove current PIN",
  "settings.newPin": "New PIN (4+ digits)",
  "settings.savePin": "Save PIN",
  "settings.generatePin": "Generate",
  "settings.data": "Data",
  "settings.dataHelp": "Export a backup or import data from another backup.",
  "settings.exportJson": "Export JSON",
  "settings.exportCsv": "Export CSV",
  "settings.importJson": "Import JSON",

  "brand.title": "Profile & branding",
  "brand.help": "Customize the name, logo and your greeting user name.",
  "brand.appName": "Program name",
  "brand.appNamePlaceholder": "Productivity",
  "brand.logo": "Logo (emoji or a letter)",
  "brand.logoPlaceholder": "P",
  "brand.logoImage": "Upload logo image",
  "brand.logoReset": "Remove image",
  "brand.userName": "Your name (greeting)",
  "brand.userNamePlaceholder": "e.g. Santiago",
  "brand.save": "Save",

  "lock.title": "App locked",
  "lock.subtitle": "Enter your PIN to continue",
  "lock.placeholder": "PIN",
  "lock.unlock": "Unlock",
  "lock.wrong": "Wrong PIN",

  "toast.saved": "Saved",
  "toast.pinSaved": "PIN saved",
  "toast.pinRemoved": "PIN removed",
  "toast.pinMin": "Minimum 4 digits",
  "toast.exported": "Exported",
  "toast.imported": "Imported successfully",
  "toast.pinGenerated": "Generated PIN: {pin} — save it",
  "common.save": "Save",
};

const dicts: Record<string, Dict> = { es, en };

export function translate(lang: string, key: string, vars?: Record<string, string | number>) {
  let s = dicts[lang]?.[key] ?? es[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  }
  return s;
}

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Hook de traducción ligado al idioma configurado. */
export function useT(): TFn {
  const lang = useConfig((s) => s.language);
  return (key, vars) => translate(lang, key, vars);
}

/** Locale BCP-47 para toLocaleDateString/toLocaleString según el idioma. */
export function localeFor(lang: string) {
  return lang === "en" ? "en-US" : "es-ES";
}
