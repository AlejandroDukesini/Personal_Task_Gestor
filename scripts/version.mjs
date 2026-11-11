#!/usr/bin/env node
// Versión única de la app. tauri.conf.json la lee de client/package.json; el
// resto de archivos deben coincidir con ella (y con el tag de la release).
//
//   node scripts/version.mjs check [vX.Y.Z]   comprueba que todo coincide
//   node scripts/version.mjs set X.Y.Z        actualiza todos los archivos
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^\d+\.\d+\.\d+$/;
const CRATE = "plan-gestor-task";

// Cada entrada sabe leer y reemplazar la versión de un archivo.
const files = [
  { file: "package.json", re: /^(\s*"version":\s*")([^"]+)(")/m },
  { file: "client/package.json", re: /^(\s*"version":\s*")([^"]+)(")/m },
  { file: "client/src-tauri/Cargo.toml", re: /^(version\s*=\s*")([^"]+)(")/m },
  { file: "client/src-tauri/Cargo.lock", re: new RegExp(`(name = "${CRATE}"\\r?\\nversion = ")([^"]+)(")`) },
  // Raíz del package-lock y su entrada del workspace client.
  { file: "package-lock.json", re: /^(\{\s*"name":\s*"gestion-tareas",\s*"version":\s*")([^"]+)(")/ },
  { file: "package-lock.json", re: /("client":\s*\{\s*"name":\s*"gestion-tareas-client",\s*"version":\s*")([^"]+)(")/ },
  { file: "README.md", re: /(badge\/versión-)([^-]+)(-)/ },
];

const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const current = () =>
  files.map(({ file, re }) => ({ file, version: read(file).match(re)?.[2] ?? "(no encontrada)" }));

const [cmd, arg] = process.argv.slice(2);

if (cmd === "check") {
  const found = current();
  const expected = arg ? arg.replace(/^v/, "") : found[1].version;
  if (arg && !/^v\d+\.\d+\.\d+$/.test(arg)) {
    console.error(`Tag inválido: "${arg}" (formato esperado vX.Y.Z)`);
    process.exit(1);
  }
  const bad = found.filter((f) => f.version !== expected);
  for (const f of found) console.log(`${f.version === expected ? "ok " : "MAL"}  ${f.version.padEnd(10)} ${f.file}`);
  if (bad.length) {
    console.error(`\nLas versiones no coinciden con ${expected}. Usa: npm run version:set -- ${expected}`);
    process.exit(1);
  }
  console.log(`\nVersión coherente: ${expected}`);
} else if (cmd === "set" && SEMVER.test(arg ?? "")) {
  for (const { file, re } of files) {
    const text = read(file);
    if (!re.test(text)) throw new Error(`No se encontró la versión en ${file}`);
    fs.writeFileSync(path.join(root, file), text.replace(re, `$1${arg}$3`));
  }
  console.log(`Versión ${arg} escrita en ${[...new Set(files.map((f) => f.file))].join(", ")}`);
} else {
  console.error("Uso: node scripts/version.mjs check [vX.Y.Z] | set X.Y.Z");
  process.exit(1);
}
