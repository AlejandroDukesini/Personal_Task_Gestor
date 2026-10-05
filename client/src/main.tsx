import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import toast, { Toaster } from "react-hot-toast";
import App from "./App";
import { registerServiceWorker } from "./lib/pwa";
import { setupDesktop } from "./lib/desktop";
import { bootDb } from "./services/localDb";
import { checkForExternalChanges, persistNow, requestPersistence } from "./services/storage";
import { startAutoBackup } from "./services/backup/backup";
import { ErrorBoundary } from "./components/ErrorBoundary";
// Fuente Inter incluida en la app (antes Google Fonts): mismos pesos, sin red.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./index.css";
// Se importa después de index.css a propósito: en empates de especificidad
// (p. ej. `.dark` vs `[data-skin=x]`) debe ganar el skin.
import "./themes/skins.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

/**
 * Antes de pintar nada se abre el almacenamiento local (IndexedDB) y se
 * migran los datos si hace falta. Así ninguna pantalla puede leer o escribir
 * sobre una base a medio cargar.
 */
async function start() {
  let info: Awaited<ReturnType<typeof bootDb>>;
  try {
    info = await bootDb();
  } catch (e) {
    root.render(<BootError message={e instanceof Error ? e.message : String(e)} />);
    return;
  }
  (window as unknown as { __gtStorageInfo?: unknown }).__gtStorageInfo = info;

  // Última oportunidad al salir o pasar a segundo plano (móvil): el espejo en
  // localStorage se escribe al momento. No es lo único: cada cambio ya se
  // guardó al hacerlo.
  window.addEventListener("pagehide", persistNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistNow();
    // Al volver, por si otra pestaña guardó algo mientras esta estaba oculta.
    else void checkForExternalChanges();
  });
  window.addEventListener("focus", () => void checkForExternalChanges());

  // Copias automáticas verificadas mientras la app está abierta.
  startAutoBackup();
  // Que el sistema no borre los datos por falta de espacio (sin bloquear el arranque).
  void requestPersistence();

  // Una escritura que falla no puede pasar desapercibida: el usuario perdería
  // cambios al cerrar la app sin saberlo.
  window.addEventListener("gt:storage-error", (e) => {
    toast.error(`No se pudieron guardar los últimos cambios: ${(e as CustomEvent).detail}. Exporta una copia de seguridad.`, {
      id: "storage-error",
      duration: 10000,
    });
  });

  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <App />
          <Toaster
            position="top-center"
            // Por encima de la barra de estado del iPhone (zona segura).
            containerStyle={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
            toastOptions={{
              style: {
                background: "rgb(var(--surface))",
                color: "rgb(var(--text))",
                border: "var(--border-w) solid rgb(var(--border))",
                borderRadius: "var(--radius-md)",
                fontFamily: "var(--font-ui)",
                maxWidth: "min(92vw, 420px)",
              },
            }}
          />
        </BrowserRouter>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

function BootError({ message }: { message: string }) {
  return (
    <div style={{ padding: "calc(env(safe-area-inset-top) + 24px) 24px 24px", fontFamily: "system-ui", color: "#e2e8f0", background: "#0f172a", minHeight: "100dvh" }}>
      <h1 style={{ fontSize: 20 }}>No se pudo abrir el almacenamiento local</h1>
      <p>{message}</p>
      <p>Cierra otras pestañas de la app y vuelve a intentarlo. Tus datos no se han modificado.</p>
      <button onClick={() => location.reload()} style={{ padding: "12px 20px", borderRadius: 10, border: 0, background: "#6366f1", color: "#fff", fontSize: 16 }}>
        Reintentar
      </button>
    </div>
  );
}

setupDesktop();
void start();
registerServiceWorker();
