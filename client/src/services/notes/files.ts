/**
 * Archivos adjuntos de las notas.
 *
 * Almacenamiento: los binarios van a una base IndexedDB PROPIA
 * (`gestion-tareas-files`), no al JSON de la app (que se guarda y sincroniza
 * entero y no debe crecer con megas de PDF). La clave es el SHA-256 del
 * contenido: el mismo archivo adjunto a dos notas se guarda una sola vez, y
 * solo se borra cuando ninguna nota (ni de la papelera) lo usa.
 *
 * Validación: el tipo se decide por el CONTENIDO (firma del archivo) y la
 * extensión, nunca por el MIME que declara el navegador. Se rechazan
 * ejecutables, scripts y formatos que el navegador podría interpretar como
 * código en el origen de la app (HTML, SVG…). Al abrir un archivo se crea el
 * Blob con el MIME de NUESTRO registro, no con el del archivo.
 */

export interface AttachmentType {
  /** Identificador del tipo (se guarda en el adjunto). */
  kind: string;
  label: string;
  extensions: string[];
  /** MIME con el que se sirve (propio, no el declarado). */
  mime: string;
  /** Comprueba la firma del contenido. */
  check: (head: Uint8Array) => boolean;
  /** Cómo se puede ver dentro de la app. */
  preview: "image" | "pdf" | "text" | null;
  maxBytes?: number;
}

const starts = (head: Uint8Array, sig: number[], at = 0) => sig.every((b, i) => head[at + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const isZip = (h: Uint8Array) => starts(h, [0x50, 0x4b, 0x03, 0x04]) || starts(h, [0x50, 0x4b, 0x05, 0x06]);
const isCfb = (h: Uint8Array) => starts(h, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Texto: sin bytes nulos ni de control raros en el principio. */
export function looksLikeText(head: Uint8Array): boolean {
  if (starts(head, [0xff, 0xfe]) || starts(head, [0xfe, 0xff])) return true;
  let bad = 0;
  for (const b of head.subarray(0, 4096)) if (b === 0 || (b < 32 && b !== 9 && b !== 10 && b !== 13 && b !== 12)) bad++;
  return bad === 0;
}

const TYPES: AttachmentType[] = [
  { kind: "pdf", label: "PDF", extensions: ["pdf"], mime: "application/pdf", check: (h) => starts(h, ascii("%PDF-")), preview: "pdf" },
  { kind: "png", label: "Imagen PNG", extensions: ["png"], mime: "image/png", check: (h) => starts(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), preview: "image" },
  { kind: "jpg", label: "Imagen JPEG", extensions: ["jpg", "jpeg"], mime: "image/jpeg", check: (h) => starts(h, [0xff, 0xd8, 0xff]), preview: "image" },
  { kind: "webp", label: "Imagen WEBP", extensions: ["webp"], mime: "image/webp", check: (h) => starts(h, ascii("RIFF")) && starts(h, ascii("WEBP"), 8), preview: "image" },
  { kind: "gif", label: "Imagen GIF", extensions: ["gif"], mime: "image/gif", check: (h) => starts(h, ascii("GIF87a")) || starts(h, ascii("GIF89a")), preview: "image" },
  { kind: "txt", label: "Texto", extensions: ["txt", "md", "csv", "tsv", "log", "json"], mime: "text/plain;charset=utf-8", check: looksLikeText, preview: "text", maxBytes: 5 * 1024 * 1024 },
  { kind: "rtf", label: "Texto enriquecido", extensions: ["rtf"], mime: "application/rtf", check: (h) => starts(h, ascii("{\\rtf")), preview: null },
  { kind: "docx", label: "Word", extensions: ["docx"], mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", check: isZip, preview: null },
  { kind: "xlsx", label: "Excel", extensions: ["xlsx"], mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", check: isZip, preview: null },
  { kind: "pptx", label: "PowerPoint", extensions: ["pptx"], mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", check: isZip, preview: null },
  { kind: "odf", label: "OpenDocument", extensions: ["odt", "ods", "odp"], mime: "application/octet-stream", check: isZip, preview: null },
  { kind: "doc", label: "Word 97-2003", extensions: ["doc"], mime: "application/msword", check: isCfb, preview: null },
  { kind: "xls", label: "Excel 97-2003", extensions: ["xls"], mime: "application/vnd.ms-excel", check: isCfb, preview: null },
  { kind: "ppt", label: "PowerPoint 97-2003", extensions: ["ppt"], mime: "application/vnd.ms-powerpoint", check: isCfb, preview: null },
];

/** Extensiones que nunca se aceptan, aunque alguien registre un tipo que las incluya. */
const BLOCKED = new Set([
  "exe", "dll", "com", "bat", "cmd", "msi", "msix", "scr", "pif", "cpl", "jar", "apk", "app", "dmg", "sh", "bash", "ps1", "psm1", "vbs", "vbe", "js", "mjs", "cjs", "jse", "wsf", "hta",
  "html", "htm", "xhtml", "shtml", "svg", "svgz", "xml", "xsl", "php", "asp", "aspx", "jsp", "py", "rb", "pl", "lnk", "reg", "iso", "img",
]);

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_NOTE_BYTES = 60 * 1024 * 1024;

export function attachmentTypes(): readonly AttachmentType[] {
  return TYPES;
}

/** Amplía los tipos admitidos (configuración extensible). */
export function registerAttachmentType(t: AttachmentType): void {
  if (t.extensions.some((e) => BLOCKED.has(e.toLowerCase()))) throw new Error("Ese tipo de archivo no se puede permitir");
  const i = TYPES.findIndex((x) => x.kind === t.kind);
  if (i >= 0) TYPES.splice(i, 1);
  TYPES.push(t);
}

export function typeOf(kind: string): AttachmentType | undefined {
  return TYPES.find((t) => t.kind === kind);
}

/**
 * Nombre seguro: solo el nombre (sin rutas), sin caracteres de control ni
 * reservados, sin puntos o espacios al principio/final y como mucho 120
 * caracteres conservando la extensión.
 */
export function safeFileName(name: string): string {
  let base = (name.split(/[\\/]/).pop() ?? "").normalize("NFC");
  base = base.replace(/[\u0000-\u001f\u007f<>:"|?*‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "");
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(base)) base = `_${base}`;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot) : "";
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return (stem.slice(0, 120 - ext.length) + ext).trim() || "archivo";
}

export interface InspectResult {
  ok: boolean;
  error?: string;
  name: string;
  type?: AttachmentType;
}

/** Valida nombre, tamaño y contenido de un archivo antes de aceptarlo. */
export function inspectAttachment(name: string, size: number, head: Uint8Array): InspectResult {
  const clean = safeFileName(name);
  const ext = (clean.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? "").toLowerCase();
  // Doble extensión engañosa: «factura.pdf.exe».
  const parts = clean.toLowerCase().split(".").slice(1);
  if (parts.some((p) => BLOCKED.has(p))) return { ok: false, name: clean, error: `«${clean}»: este tipo de archivo no se admite por seguridad` };
  if (!ext) return { ok: false, name: clean, error: `«${clean}» no tiene extensión: no se puede saber qué tipo de archivo es` };
  if (size <= 0) return { ok: false, name: clean, error: `«${clean}» está vacío` };
  // Ejecutables disfrazados: firma MZ (Windows), ELF (Linux), Mach-O o script con «#!».
  if (starts(head, [0x4d, 0x5a]) || starts(head, [0x7f, 0x45, 0x4c, 0x46]) || starts(head, [0xcf, 0xfa, 0xed, 0xfe]) || starts(head, [0xca, 0xfe, 0xba, 0xbe])) {
    return { ok: false, name: clean, error: `«${clean}» es un programa ejecutable: no se admite` };
  }
  const candidates = TYPES.filter((t) => t.extensions.includes(ext));
  if (!candidates.length) return { ok: false, name: clean, error: `«${clean}»: la extensión .${ext} no está entre los tipos admitidos` };
  const type = candidates.find((t) => t.check(head));
  if (!type) return { ok: false, name: clean, error: `«${clean}»: el contenido no corresponde a un archivo .${ext} (¿dañado o renombrado?)` };
  const max = Math.min(type.maxBytes ?? MAX_FILE_BYTES, MAX_FILE_BYTES);
  if (size > max) return { ok: false, name: clean, error: `«${clean}» supera el máximo de ${Math.round(max / 1024 / 1024)} MB` };
  // Un .txt con «<script>» se acepta: siempre se abre como texto plano, nunca como HTML.
  return { ok: true, name: clean, type };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------ almacén IDB */

const DB_NAME = "gestion-tareas-files";
const STORE = "files";

interface StoredFile {
  bytes: ArrayBuffer;
  size: number;
  createdAt: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openFiles(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Este navegador no permite guardar archivos adjuntos (sin IndexedDB)"));
  dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => {
      dbPromise = null;
      reject(r.error ?? new Error("No se pudo abrir el almacén de archivos"));
    };
  });
  return dbPromise;
}

function done<T>(req: IDBRequest<T> | null, tx: IDBTransaction): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error ?? new Error("Error del almacén de archivos"));
    tx.onabort = () => reject(tx.error ?? new Error("Operación cancelada (¿sin espacio?)"));
  });
}

/** Guarda el contenido (si no estaba ya) y devuelve su clave SHA-256. */
export async function putFile(bytes: Uint8Array): Promise<string> {
  const key = await sha256Hex(bytes);
  const db = await openFiles();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const existing = store.getKey(key);
  existing.onsuccess = () => {
    if (existing.result === undefined) {
      const copy = bytes.slice().buffer as ArrayBuffer;
      store.put({ bytes: copy, size: bytes.length, createdAt: new Date().toISOString() } satisfies StoredFile, key);
    }
  };
  await done(null, tx);
  return key;
}

export async function getFile(key: string): Promise<Uint8Array | null> {
  if (!/^[0-9a-f]{64}$/.test(key)) return null;
  const db = await openFiles();
  const tx = db.transaction(STORE);
  const r = tx.objectStore(STORE).get(key) as IDBRequest<StoredFile | undefined>;
  const v = await done(r, tx);
  return v ? new Uint8Array(v.bytes) : null;
}

export async function hasFile(key: string): Promise<boolean> {
  const db = await openFiles();
  const tx = db.transaction(STORE);
  const r = tx.objectStore(STORE).getKey(key);
  return (await done(r, tx)) !== undefined;
}

export async function listFileKeys(): Promise<string[]> {
  const db = await openFiles();
  const tx = db.transaction(STORE);
  const r = tx.objectStore(STORE).getAllKeys();
  return ((await done(r, tx)) ?? []).map(String);
}

/**
 * Borra los archivos indicados que ya no usa ninguna nota. `inUse` es el
 * conjunto actual de claves referenciadas: se vuelve a comprobar justo antes
 * de borrar para no eliminar nada que otra nota siga usando.
 */
export async function releaseFiles(keys: string[], inUse: Set<string>): Promise<number> {
  const victims = [...new Set(keys)].filter((k) => !inUse.has(k));
  if (!victims.length) return 0;
  const db = await openFiles();
  const tx = db.transaction(STORE, "readwrite");
  for (const k of victims) tx.objectStore(STORE).delete(k);
  await done(null, tx);
  return victims.length;
}

/** Limpieza general: borra los archivos huérfanos (p. ej. tras un fallo a mitad de adjuntar). */
export async function collectGarbage(inUse: Set<string>): Promise<number> {
  return releaseFiles(await listFileKeys(), inUse);
}

/** Para pruebas: olvida la conexión abierta. */
export function __resetFilesForTests(): void {
  dbPromise = null;
}

export interface FileInfo {
  key: string;
  size: number;
  createdAt: string;
}

export async function listFiles(): Promise<FileInfo[]> {
  const db = await openFiles();
  const tx = db.transaction(STORE);
  const store = tx.objectStore(STORE);
  const keysReq = store.getAllKeys();
  const valsReq = store.getAll() as IDBRequest<StoredFile[]>;
  await done(null, tx);
  return keysReq.result.map((k, i) => ({ key: String(k), size: valsReq.result[i]?.size ?? 0, createdAt: valsReq.result[i]?.createdAt ?? "" }));
}

/**
 * Limpieza EXPLÍCITA (la pide el usuario): borra solo los adjuntos que no usa
 * ninguna nota actual NI ninguna copia de seguridad guardada, y que tienen
 * más de `minAgeDays` días. Nada se borra automáticamente: una pestaña con
 * datos desfasados borraba así adjuntos recién añadidos en otra.
 */
export async function cleanupOrphanFiles(inUse: Set<string>, minAgeDays = 7, now = Date.now()): Promise<{ removed: number; bytes: number }> {
  const cutoff = now - minAgeDays * 86_400_000;
  const victims = (await listFiles()).filter((f) => !inUse.has(f.key) && (!f.createdAt || new Date(f.createdAt).getTime() < cutoff));
  if (!victims.length) return { removed: 0, bytes: 0 };
  await releaseFiles(victims.map((v) => v.key), inUse);
  return { removed: victims.length, bytes: victims.reduce((a, v) => a + v.size, 0) };
}
