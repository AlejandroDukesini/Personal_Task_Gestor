import { handleRequest } from "@/services/localApi";

/** Llama al router local como lo hace `api.ts` (con el viaje JSON incluido). */
export async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const payload = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
  const res = await handleRequest(method, path, payload);
  return res.body as T;
}

/** Espera que la llamada falle con el código HTTP indicado. */
export async function expectStatus(status: number, p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e: any) {
    if (e?.status !== status) throw new Error(`Se esperaba ${status}, llegó ${e?.status}: ${e?.message}`);
    return e.message;
  }
  throw new Error(`Se esperaba un error ${status} y la llamada tuvo éxito`);
}

export async function makeAccount(over: Record<string, unknown> = {}) {
  return call("POST", "/finance/accounts", {
    name: `Cuenta ${Math.random().toString(36).slice(2, 7)}`,
    type: "bank",
    currency: "COP",
    initialBalance: 0,
    ...over,
  });
}

export async function makeTx(over: Record<string, unknown>) {
  return call("POST", "/finance/transactions", {
    kind: "expense",
    amount: 1000,
    date: "2026-09-10",
    concept: "Prueba",
    ...over,
  });
}
