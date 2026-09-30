import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ArchiveRestore, CheckCircle2, DatabaseBackup, Download, HardDrive, History, Info, Lock, ShieldCheck, Smartphone, Trash2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Input";
import { useSaveStatus } from "./SaveIndicator";
import { downloadBackup, downloadText } from "./download";
import {
  SUPPORTED_FORMATS_HELP,
  attachmentsInUse,
  backupFileName,
  createLocalBackup,
  loadBackupPrefs,
  loadBackupStatus,
  localBackupAsFile,
  markDownloaded,
  onBackupChange,
  restoreLocalBackup,
  saveBackupPrefs,
  serializeBackup,
  type BackupPrefs,
} from "@/services/backup/backup";
import { deleteRestorePoint, listRestorePoints, requestPersistence, storageEstimate, storageKind, type RestorePoint } from "@/services/storage";
import { cleanupOrphanFiles } from "@/services/notes/files";
import { cn } from "@/lib/utils";
import { useRestoreWizard } from "@/store/restoreWizard";

const fmtBytes = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" }) : "Nunca");

const KIND_LABEL: Record<string, string> = { auto: "Automática", manual: "Manual", "pre-action": "Antes de una acción" };

export function BackupCard() {
  const save = useSaveStatus();
  const [prefs, setPrefs] = useState<BackupPrefs>(loadBackupPrefs);
  const [status, setStatus] = useState(loadBackupStatus);
  const [points, setPoints] = useState<RestorePoint[]>([]);
  const [est, setEst] = useState<{ persisted: boolean | null; usage: number | null; quota: number | null }>({ persisted: null, usage: null, quota: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [dl, setDl] = useState({ open: false, includeFiles: true, encrypt: false, password: "", confirm: "" });
  const [historyOpen, setHistoryOpen] = useState(false);
  const openWizard = useRestoreWizard((st) => st.openWizard);

  const refresh = useCallback(async () => {
    setStatus(loadBackupStatus());
    setPoints(await listRestorePoints().catch(() => []));
    setEst(await storageEstimate());
  }, []);

  useEffect(() => {
    void refresh();
    return onBackupChange(() => void refresh());
  }, [refresh]);

  useEffect(() => {
    if (window.location.hash === "#copias") document.getElementById("copias")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e: any) {
      toast.error(e?.message ?? "Operación fallida");
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  function updatePrefs(patch: Partial<BackupPrefs>) {
    setPrefs(saveBackupPrefs(patch));
  }

  const kind = storageKind();

  return (
    <Card className="lg:col-span-2" id="copias">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseBackup size={16} /> Copias de seguridad y restauración
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm">
          Tus datos se guardan en este dispositivo. Para protegerlos ante una limpieza del navegador o un fallo del dispositivo, descarga
          periódicamente una copia de seguridad y guárdala en un lugar seguro.
        </p>

        {/* Estado del almacenamiento */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <Stat icon={<HardDrive size={14} />} label="Almacenamiento" value={kind === "indexeddb" ? "IndexedDB (principal)" : "localStorage (limitado)"} warn={kind !== "indexeddb"} />
          <Stat
            icon={<ShieldCheck size={14} />}
            label="Copia espejo (localStorage)"
            value={save.mirror === "ok" ? `Activa${save.mirrorSavedAt ? ` · ${fmtDate(save.mirrorSavedAt)}` : ""}` : save.mirror === "too-large" ? "No cabe (datos > 4 MB)" : save.mirror === "error" ? "Sin espacio" : kind === "indexeddb" ? "Pendiente" : "—"}
            warn={save.mirror === "error"}
          />
          <Stat
            icon={<Lock size={14} />}
            label="Protección contra borrado automático"
            value={est.persisted ? "Concedida" : est.persisted === false ? "No concedida" : "Desconocida"}
            warn={est.persisted === false}
            action={
              est.persisted === false ? (
                <button
                  className="text-xs underline"
                  onClick={async () => {
                    const ok = await requestPersistence();
                    toast(ok ? "El navegador protegerá tus datos" : "El navegador no la concedió (suele concederla al instalar la app o añadirla a favoritos)");
                    void refresh();
                  }}
                >
                  Solicitar
                </button>
              ) : null
            }
          />
          <Stat icon={<HardDrive size={14} />} label="Espacio usado" value={`${fmtBytes(est.usage)} de ${fmtBytes(est.quota)}`} />
        </div>

        {/* Última copia y última operación */}
        <div className="grid gap-2 sm:grid-cols-3 text-sm">
          <div className="rounded-lg bg-muted p-3">
            <div className="text-xs text-subtle">Última copia en el navegador</div>
            <div className="font-medium">{fmtDate(status.lastLocalBackupAt)}</div>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <div className="text-xs text-subtle">Última copia descargada</div>
            <div className="font-medium">
              {fmtDate(status.lastDownloadAt)}
              {status.lastDownloadSize ? <span className="text-subtle font-normal"> · {fmtBytes(status.lastDownloadSize)}</span> : null}
            </div>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <div className="text-xs text-subtle">Última operación</div>
            {status.lastOp ? (
              <div className={cn("font-medium flex items-start gap-1.5", status.lastOp.ok ? "" : "text-danger")}>
                {status.lastOp.ok ? <CheckCircle2 size={14} className="text-success mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
                <span>
                  {status.lastOp.action}: {status.lastOp.message}
                  <span className="block text-xs text-subtle font-normal">{fmtDate(status.lastOp.at)}</span>
                </span>
              </div>
            ) : (
              <div className="font-medium">—</div>
            )}
          </div>
        </div>

        {/* Acciones */}
        <div className="flex flex-wrap gap-2">
          <Button
            loading={busy === "create"}
            onClick={() =>
              run("create", async () => {
                const p = await createLocalBackup("Copia manual", "manual");
                toast.success(`Copia creada y verificada (${fmtBytes(p.size)})`);
              })
            }
          >
            <DatabaseBackup size={15} /> Crear copia de seguridad
          </Button>
          <Button variant="outline" onClick={() => setDl({ ...dl, open: true, password: "", confirm: "" })}>
            <Download size={15} /> Descargar copia de seguridad
          </Button>
          <Button variant="outline" onClick={() => openWizard({ origin: "settings" })}>
            <ArchiveRestore size={15} /> Restaurar copia de seguridad
          </Button>
          <Button variant="outline" onClick={() => openWizard({ origin: "other-device" })}>
            <Smartphone size={15} /> Importar copia desde otro dispositivo
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setHistoryOpen(true);
              setTimeout(() => document.getElementById("historial-copias")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
            }}
          >
            <History size={15} /> Ver historial de copias
          </Button>
        </div>

        {/* Historial */}
        <details
          id="historial-copias"
          className="rounded-lg border border-border"
          open={historyOpen}
          onToggle={(e) => setHistoryOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer p-3 text-sm font-medium flex items-center gap-2">
            <History size={15} /> Copias guardadas en este navegador ({points.length})
          </summary>
          <div className="px-3 pb-3 space-y-2">
            {points.length === 0 && <p className="text-sm text-subtle">Aún no hay copias. Se crean solas cada cierto tiempo y antes de acciones de riesgo.</p>}
            {points.map((p) => (
              <div key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-md bg-muted p-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{p.reason}</div>
                  <div className="text-xs text-subtle flex flex-wrap gap-x-2">
                    <span>{fmtDate(p.at)}</span>
                    <span>{KIND_LABEL[p.kind ?? "pre-action"]}</span>
                    <span>{fmtBytes(p.size)}</span>
                    <span>esquema v{p.version}</span>
                    {p.verified ? <span className="text-success">verificada</span> : <span className="text-warning">sin verificar</span>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Descargar esta copia"
                    aria-label="Descargar esta copia"
                    onClick={() =>
                      run(`dl-${p.id}`, async () => {
                        const text = await serializeBackup(await localBackupAsFile(p.id));
                        downloadText(backupFileName(new Date(p.at)), text);
                        markDownloaded(text.length);
                      })
                    }
                  >
                    <Download size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Volver a esta copia"
                    aria-label="Volver a esta copia"
                    loading={busy === `rs-${p.id}`}
                    onClick={() => {
                      if (!confirm(`¿Volver a la copia del ${fmtDate(p.at)}? Tus datos actuales se REEMPLAZARÁN (antes se guardará una copia de ellos).`)) return;
                      run(`rs-${p.id}`, async () => {
                        await restoreLocalBackup(p.id);
                        toast.success("Datos restaurados");
                      });
                    }}
                  >
                    <ArchiveRestore size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Eliminar esta copia"
                    aria-label="Eliminar esta copia"
                    onClick={() => {
                      if (!confirm("¿Eliminar esta copia? No afecta a tus datos actuales.")) return;
                      run(`del-${p.id}`, () => deleteRestorePoint(p.id));
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </details>

        {/* Información */}
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer p-3 text-sm font-medium flex items-center gap-2">
            <Info size={15} /> Información sobre las copias
          </summary>
          <div className="px-3 pb-3 text-sm space-y-2">
            <p>
              <strong>Sin cifrar</strong> (opción por defecto): el archivo se restaura en cualquier dispositivo <strong>sin contraseña</strong>. Cualquiera que lo tenga
              puede leer tus datos, así que guárdalo en un lugar seguro.
            </p>
            <p>
              <strong>Cifrada</strong>: al descargarla marcas «Cifrar con contraseña». El archivo indica que está cifrado (AES-256-GCM) y al restaurarlo se pide esa
              contraseña. La contraseña no se guarda en ningún sitio: si la olvidas, la copia no se puede abrir.
            </p>
            <p>
              <strong>Cómo restaurar</strong>: pulsa «Restaurar copia de seguridad» (o «Importar copia desde otro dispositivo») y elige el archivo. La app detecta sola
              si está cifrada, te muestra qué contiene y, antes de cambiar nada, guarda una copia de tus datos actuales.
            </p>
            <p className="text-subtle">{SUPPORTED_FORMATS_HELP}</p>
          </div>
        </details>

        {/* Preferencias */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Copias automáticas">
            <Select value={prefs.autoIntervalMin} onChange={(e) => updatePrefs({ autoIntervalMin: Number(e.target.value) })}>
              <option value={0}>Desactivadas</option>
              <option value={30}>Cada 30 minutos de uso</option>
              <option value={60}>Cada hora de uso</option>
              <option value={180}>Cada 3 horas de uso</option>
              <option value={720}>Cada 12 horas de uso</option>
            </Select>
          </Field>
          <Field label="Copias automáticas a conservar">
            <Select value={prefs.maxAuto} onChange={(e) => updatePrefs({ maxAuto: Number(e.target.value) })}>
              {[5, 8, 12, 20, 30].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Recordar descargar una copia">
            <Select value={prefs.remindDays} onChange={(e) => updatePrefs({ remindDays: Number(e.target.value) })}>
              <option value={0}>Nunca</option>
              <option value={3}>Cada 3 días</option>
              <option value={7}>Cada semana</option>
              <option value={14}>Cada 2 semanas</option>
              <option value={30}>Cada mes</option>
            </Select>
          </Field>
        </div>

        <div className="text-xs text-subtle space-y-1.5">
          <p>
            <strong>Privacidad:</strong> una copia descargada contiene tus datos privados (tareas, notas, finanzas…). Guárdala en un lugar seguro o
            cífrala con contraseña. Nunca incluye el PIN.
          </p>
          <p>
            Ningún navegador garantiza que sus datos no se borren (limpieza de datos del sitio, modo incógnito, falta de espacio o, en Safari,
            varios días sin abrir la web). Instalar la app y descargar copias con regularidad es la mejor protección.
          </p>
          <button
            className="underline"
            disabled={!!busy}
            onClick={() =>
              run("gc", async () => {
                if (!confirm("¿Liberar el espacio de adjuntos que ya no usa ninguna nota ni ninguna copia guardada y tienen más de 7 días?")) return;
                const r = await cleanupOrphanFiles(await attachmentsInUse());
                toast.success(r.removed ? `Liberados ${fmtBytes(r.bytes)} (${r.removed} adjuntos)` : "No hay adjuntos sin usar");
              })
            }
          >
            Liberar espacio de adjuntos sin usar
          </button>
        </div>
      </CardContent>

      {/* Diálogo de descarga */}
      <Dialog open={dl.open} onClose={() => setDl({ ...dl, open: false })} title="Descargar copia de seguridad" size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (dl.encrypt && dl.password.length < 8) return toast.error("La contraseña debe tener al menos 8 caracteres");
            if (dl.encrypt && dl.password !== dl.confirm) return toast.error("Las contraseñas no coinciden");
            run("download", async () => {
              const size = await downloadBackup({ includeFiles: dl.includeFiles, password: dl.encrypt ? dl.password : null });
              toast.success(`Copia descargada (${fmtBytes(size)}). Guárdala fuera del navegador.`);
              setDl({ ...dl, open: false, password: "", confirm: "" });
            });
          }}
        >
          <p className="text-sm text-subtle">Incluye todos los módulos, sus relaciones y los ajustes compartidos. El archivo lleva una suma de comprobación para detectar daños.</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={dl.includeFiles} onChange={(e) => setDl({ ...dl, includeFiles: e.target.checked })} />
            Incluir los archivos adjuntos de las notas
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={dl.encrypt} onChange={(e) => setDl({ ...dl, encrypt: e.target.checked })} />
            Cifrar con contraseña (AES-256)
          </label>
          {!dl.encrypt && (
            <p className="text-xs text-subtle">
              Sin cifrar: se restaura en cualquier dispositivo <strong>sin contraseña</strong>, pero cualquiera con el archivo puede leer tus datos. Guárdalo en un lugar seguro.
            </p>
          )}
          {dl.encrypt && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Contraseña">
                <Input type="password" autoComplete="new-password" value={dl.password} onChange={(e) => setDl({ ...dl, password: e.target.value })} />
              </Field>
              <Field label="Repetir contraseña">
                <Input type="password" autoComplete="new-password" value={dl.confirm} onChange={(e) => setDl({ ...dl, confirm: e.target.value })} />
              </Field>
              <p className="text-xs text-subtle sm:col-span-2">Si olvidas la contraseña, la copia no se podrá recuperar.</p>
            </div>
          )}
          <div className="flex justify-end">
            <Button type="submit" loading={busy === "download"}>
              <Download size={15} /> Descargar
            </Button>
          </div>
        </form>
      </Dialog>

    </Card>
  );
}

function Stat({ icon, label, value, warn, action }: { icon: React.ReactNode; label: string; value: string; warn?: boolean; action?: React.ReactNode }) {
  return (
    <div className={cn("rounded-lg border p-3", warn ? "border-warning/50" : "border-border")}>
      <div className="text-xs text-subtle flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div className={cn("font-medium", warn && "text-warning")}>{value}</div>
      {action}
    </div>
  );
}
