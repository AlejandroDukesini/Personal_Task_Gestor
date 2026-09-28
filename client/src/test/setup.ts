// Entorno de pruebas: la app persiste en localStorage, que Node no tiene.
// Un almacenamiento en memoria, limpio antes de cada prueba, basta para
// ejercitar la base local, el router y la sincronización tal cual corren en
// el navegador.

import { beforeEach } from "vitest";
import { resetDb } from "@/services/localDb";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

(globalThis as any).localStorage = new MemoryStorage();

beforeEach(() => {
  localStorage.clear();
  resetDb();
});
