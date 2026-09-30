import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { AlertTriangle, Download, Info, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useSaveStatus } from "./SaveIndicator";
import { downloadBackup } from "./download";
import { needsBackupReminder, onBackupChange, snoozeReminder } from "@/services/backup/backup";
import type { StorageInfo } from "@/services/storage";

function bootInfo(): StorageInfo | null {
  return ((window as unknown as { __gtStorageInfo?: StorageInfo }).__gtStorageInfo as StorageInfo) ?? null;
}

function Banner({ tone, icon, children, onClose }: { tone: "danger" | "warning" | "info"; icon: React.ReactNode; children: React.ReactNode; onClose?: () => void }) {
  const cls =
    tone === "danger" ? "border-danger/40 bg-danger/10" : tone === "warning" ? "border-warning/40 bg-warning/10" : "border-primary/30 bg-primary/5";
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`mb-4 flex gap-3 rounded-lg border p-3 text-sm ${cls}`}>
      <span className="shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0 space-y-2">{children}</div>
      {onClose && (
        <button onClick={onClose} className="shrink-0 h-8 w-8 -m-1 flex items-center justify-center rounded-md hover:bg-muted" aria-label="Cerrar aviso">
          <X size={15} />
        </button>
      )}
    </div>
  );
}

/**
 * Avisos sobre la seguridad de los datos, arriba de cada página:
 *  - no se pudo guardar (con descarga de emergencia desde la memoria);
 *  - se recuperaron datos de una copia al arrancar;
 *  - almacenamiento reducido (sin IndexedDB);
 *  - recordatorio de descargar una copia externa.
 */
export function StorageAlerts() {
  const save = useSaveStatus();
  const [info] = useState(bootInfo);
  const [recoveredSeen, setRecoveredSeen] = useState(false);
  const [remind, setRemind] = useState(() => needsBackupReminder());
  useEffect(() => onBackupChange(() => setRemind(needsBackupReminder())), []);

  async function emergency() {
    try {
      await downloadBackup({ includeFiles: false });
      toast.success("Copia descargada. Guárdala en un lugar seguro.");
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo generar la copia");
    }
  }

  return (
    <>
      {save.state === "error" && (
        <Banner tone="danger" icon={<AlertTriangle size={18} className="text-danger" />}>
          <p>
            <strong>No se pudieron guardar tus últimos cambios</strong> ({save.error}). Siguen en esta pestaña mientras no la cierres:
            descarga ahora una copia para no perderlos.
          </p>
          <Button size="sm" variant="danger" onClick={emergency}>
            <Download size={14} /> Descargar copia de emergencia
          </Button>
        </Banner>
      )}
      {!recoveredSeen && (info?.recoveredFromMirror || info?.recoveredFromRestorePoint) && (
        <Banner tone="info" icon={<Info size={18} className="text-primary" />} onClose={() => setRecoveredSeen(true)}>
          <p>
            {info.recoveredFromMirror
              ? "Se recuperaron cambios que no habían terminado de guardarse la última vez (copia espejo)."
              : `El almacenamiento principal estaba vacío: se recuperaron tus datos de la copia de seguridad del ${new Date(info.recoveredFromRestorePoint!).toLocaleString("es-ES")}.`}{" "}
            Revisa que todo esté en orden.
          </p>
        </Banner>
      )}
      {info?.degraded && (
        <Banner tone="warning" icon={<AlertTriangle size={18} className="text-warning" />}>
          <p>
            El almacenamiento principal del navegador (IndexedDB) no está disponible, quizá por el modo privado. Los datos se guardan en un
            espacio más limitado y podrían perderse al cerrar: <Link className="underline" to="/configuracion#copias">descarga una copia</Link>.
          </p>
        </Banner>
      )}
      {remind && save.state !== "error" && (
        <Banner
          tone="warning"
          icon={<ShieldCheck size={18} className="text-warning" />}
          onClose={() => {
            snoozeReminder(1);
            setRemind(false);
          }}
        >
          <p>
            Tus datos se guardan en este dispositivo. Para protegerlos ante una limpieza del navegador o un fallo del dispositivo, descarga
            periódicamente una copia de seguridad y guárdala en un lugar seguro.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={emergency}>
              <Download size={14} /> Descargar copia ahora
            </Button>
            <Link to="/configuracion#copias" className="text-xs underline self-center">
              Opciones de copias
            </Link>
          </div>
        </Banner>
      )}
    </>
  );
}
