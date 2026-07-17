// La app es local-first: no hay servidor. Las peticiones se resuelven contra el
// almacenamiento del navegador, conservando la misma interfaz que tenía el
// cliente HTTP para que las páginas no cambien.

import { handleRequest } from "./localApi";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Mismo viaje que hacía JSON.stringify por la red: normaliza fechas y descarta
  // valores no serializables antes de tocar el almacenamiento.
  const payload = body === undefined ? undefined : JSON.parse(JSON.stringify(body));

  const res = await handleRequest(method, path, payload);
  if (res.status === 204) return undefined as T;
  return res.body as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
