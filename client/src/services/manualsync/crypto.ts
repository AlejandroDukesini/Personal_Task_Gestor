/**
 * Cifrado de lo que sale del dispositivo: archivos de sincronización, copias
 * de seguridad y mensajes por red.
 *
 * AES-256-GCM (confidencialidad + integridad: un byte alterado hace fallar el
 * descifrado) con clave derivada por PBKDF2-SHA256. Todo con Web Crypto, que
 * existe en Safari/iOS y en Node; requiere contexto seguro (https o
 * localhost), igual que la instalación como PWA.
 *
 * La contraseña o el secreto de emparejamiento nunca se guardan en el
 * archivo: sin ellos, el contenido es ilegible.
 */

export const ENVELOPE_FORMAT = "gestion-tareas/sealed";
const ITERATIONS_PASSWORD = 310_000;
/** Los secretos de emparejamiento son aleatorios de 256 bits: basta con menos iteraciones. */
const ITERATIONS_SECRET = 10_000;

export interface Envelope {
  format: typeof ENVELOPE_FORMAT;
  v: 1;
  /** Qué hay dentro (visible sin descifrar, para mensajes de error útiles). */
  content: "backup" | "offer" | "answer" | "message";
  alg: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) {
    throw new Error("El cifrado requiere abrir la app por https o localhost (contexto seguro).");
  }
  return s;
}

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomSecret(bytes = 32): string {
  return toB64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function deriveKey(secret: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const id = `${iterations}|${toB64(salt)}|${secret}`;
  let k = keyCache.get(id);
  if (!k) {
    k = (async () => {
      const base = await subtle().importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveKey"]);
      return subtle().deriveKey(
        { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
    })();
    keyCache.set(id, k);
    if (keyCache.size > 32) keyCache.delete(keyCache.keys().next().value!);
  }
  return k;
}

/** Cifra un objeto. `kind` = "password" (lo escribe el usuario) o "secret" (emparejamiento). */
export async function seal(
  value: unknown,
  secret: string,
  content: Envelope["content"],
  kind: "password" | "secret" = "password"
): Promise<Envelope> {
  if (!secret) throw new Error("Falta la contraseña");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = kind === "password" ? ITERATIONS_PASSWORD : ITERATIONS_SECRET;
  const key = await deriveKey(secret, salt, iterations);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  // El tipo de contenido entra como dato autenticado: no se puede cambiar
  // una "respuesta" por una "copia" sin romper el descifrado.
  const aad = new TextEncoder().encode(`${ENVELOPE_FORMAT}|${content}`);
  const cipher = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: aad }, key, plain)
  );
  return {
    format: ENVELOPE_FORMAT,
    v: 1,
    content,
    alg: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: toB64(salt),
    iv: toB64(iv),
    data: toB64(cipher),
  };
}

export function isEnvelope(v: unknown): v is Envelope {
  const e = v as Envelope;
  return !!e && e.format === ENVELOPE_FORMAT && e.v === 1 && e.alg === "AES-GCM" && typeof e.data === "string";
}

/** Descifra. Lanza un error comprensible si la clave no es la correcta o el archivo se alteró. */
export async function open<T = unknown>(env: Envelope, secret: string): Promise<T> {
  if (!isEnvelope(env)) throw new Error("El archivo no es un paquete cifrado de la app");
  if (env.iterations < 1000 || env.iterations > 5_000_000) throw new Error("Parámetros de cifrado no válidos");
  const key = await deriveKey(secret, fromB64(env.salt), env.iterations);
  const aad = new TextEncoder().encode(`${ENVELOPE_FORMAT}|${env.content}`);
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt(
      { name: "AES-GCM", iv: fromB64(env.iv) as BufferSource, additionalData: aad },
      key,
      fromB64(env.data) as BufferSource
    );
  } catch {
    throw new Error("No se pudo descifrar: la contraseña no es correcta o el archivo está dañado.");
  }
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
