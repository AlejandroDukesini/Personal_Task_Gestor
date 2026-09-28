export {};
// "PC" de la prueba de extremo a extremo: un proceso aparte con su propio
// almacenamiento que ejecuta el código real de la app en modo "Recibir
// sincronizaciones". Se controla por stdin/stdout con líneas JSON.
//   argv: <url del servicio> <código>

class MemoryStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
}
(globalThis as any).localStorage = new MemoryStorage();
// Node no tiene `window`: un EventTarget basta para los eventos de la app.
(globalThis as any).window = new EventTarget();
(globalThis as any).CustomEvent ??= class extends Event {
  detail: unknown;
  constructor(t: string, o?: { detail?: unknown }) {
    super(t);
    this.detail = o?.detail;
  }
};

const { loadDb } = await import("@/services/localDb");
const { handleRequest } = await import("@/services/localApi");
const { setDeviceName } = await import("@/services/manualsync/session");
const { listen } = await import("@/services/manualsync/network");
const { entriesOf, manifestOf } = await import("@/services/manualsync/keyspace");

const [url, code] = process.argv.slice(2);
const out = (o: unknown) => process.stdout.write(`@@${JSON.stringify(o)}\n`);

loadDb();
await setDeviceName("PC de prueba");
await handleRequest("POST", "/tasks", { title: "Creada en el PC" });

await listen(url, code, {
  onPaired: (d: { name: string }) => out({ ev: "paired", name: d.name }),
  onSynced: (peer: string, summary: unknown) => out({ ev: "synced", peer, summary }),
  onError: (message: string) => out({ ev: "error", message }),
});
out({ ev: "ready" });

let buf = "";
process.stdin.on("data", async (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    const cmd = JSON.parse(line);
    if (cmd.do === "manifest") out({ ev: "manifest", manifest: manifestOf(entriesOf(loadDb())) });
    if (cmd.do === "request") {
      const res = await handleRequest(cmd.method, cmd.path, cmd.body);
      out({ ev: "response", body: res.body });
    }
  }
});
