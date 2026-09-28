import { Component, type ReactNode } from "react";
import { flushStorage } from "@/services/storage";

/**
 * Red de seguridad de la interfaz. El caso típico en una PWA: tras instalar
 * una versión nueva, una pestaña abierta con la versión anterior intenta
 * cargar un fragmento de código que ya no existe. Se ofrece recargar (los
 * datos están guardados en el dispositivo y no se tocan).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const isChunk = /Loading chunk|dynamically imported module|Importing a module script failed/i.test(error.message);
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-6 bg-bg text-text" style={{ paddingTop: "calc(env(safe-area-inset-top) + 24px)" }}>
        <div className="gt-surface p-6 max-w-sm w-full space-y-3 text-center">
          <h1 className="gt-heading text-lg">{isChunk ? "Hay una versión nueva de la app" : "Algo salió mal"}</h1>
          <p className="text-sm text-subtle">
            {isChunk
              ? "Recarga para usar la versión actualizada. Tus datos están guardados en el dispositivo."
              : "La pantalla falló, pero tus datos están guardados en el dispositivo. Recarga para continuar."}
          </p>
          <button
            className="gt-control w-full h-12 bg-primary text-primary-fg font-medium"
            onClick={async () => {
              await flushStorage();
              location.reload();
            }}
          >
            Recargar
          </button>
        </div>
      </div>
    );
  }
}
