import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArchiveRestore, CheckCircle2, FileUp, KeyRound, Loader2, LockOpen, Lock, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Field, Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { useRestoreWizard } from "@/store/restoreWizard";
import {
  BackupError,
  SUPPORTED_FORMATS_HELP,
  countsOf,
  inspectBackupText,
  parseBackupText,
  restoreParsed,
  type BackupInspection,
  type ParsedBackup,
  type RestoreResult,
  type RestoreStep,
} from "@/services/backup/backup";
import { loadDb } from "@/services/localDb";

const MAX_FILE = 200 * 1024 * 1024;
const STEPS = ["Archivo", "Comprobación", "Vista previa", "Restaurar", "Listo"];

type Phase =
  | { name: "select" }
  | { name: "checking" }
  | { name: "password"; error: string | null }
  | { name: "preview" }
  | { name: "restoring"; step: RestoreStep }
  | { name: "done"; result: RestoreResult; counts: Record<string, number> }
  | { name: "failed"; message: string; canRetry: boolean };

const stepIndex = (p: Phase["name"]) =>
  p === "select" ? 0 : p === "checking" || p === "password" ? 1 : p === "preview" ? 2 : p === "restoring" || p === "failed" ? 3 : 4;

const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" }) : "desconocida");

/**
 * Restauración guiada: elegir archivo → detectar tipo y cifrado → (contraseña
 * solo si está cifrada) → vista previa → confirmar → copia previa → restaurar
 * → verificar → resultado. Los datos actuales no se tocan hasta el paso
 * «Restaurar», y si algo falla se vuelve al estado anterior.
 */
export function RestoreWizard() {
  const { open, file: initialFile, origin, session, close } = useRestoreWizard();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ name: "select" });
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [inspection, setInspection] = useState<BackupInspection | null>(null);
  const [password, setPassword] = useState("");
  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [mode, setMode] = useState<"replace" | "merge">("replace");
  const [ack, setAck] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cada apertura empieza de cero (y con el archivo, si se abrió con uno).
  useEffect(() => {
    if (!open) return;
    setPhase({ name: "select" });
    setFileName(null);
    setText(null);
    setInspection(null);
    setPassword("");
    setParsed(null);
    setMode("replace");
    setAck(false);
    if (initialFile) void load(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session]);

  async function load(f: File | undefined | null) {
    if (!f) return;
    setFileName(f.name);
    setParsed(null);
    setPassword("");
    setAck(false);
    if (f.size > MAX_FILE) {
      setPhase({ name: "failed", message: `El archivo es demasiado grande (${Math.round(f.size / 1024 / 1024)} MB) para ser una copia de esta app.`, canRetry: false });
      return;
    }
    setPhase({ name: "checking" });
    let content: string;
    try {
      content = await f.text();
    } catch {
      setPhase({ name: "failed", message: "No se pudo leer el archivo. Vuelve a elegirlo.", canRetry: false });
      return;
    }
    setText(content);
    const kind = inspectBackupText(content);
    setInspection(kind);
    if (kind.status === "invalid" || kind.status === "uncertain") {
      setPhase({ name: "failed", message: `${kind.reason} ${SUPPORTED_FORMATS_HELP}`, canRetry: false });
      return;
    }
    if (kind.status === "sync-package") {
      setPhase({
        name: "failed",
        message: "Este archivo es un paquete de sincronización (no una copia de seguridad). Ábrelo en Sincronización › Sincronizar con archivo cifrado.",
        canRetry: false,
      });
      return;
    }
    if (kind.encrypted) {
      setPhase({ name: "password", error: null });
      return;
    }
    await validate(content, null);
  }

  async function validate(content: string, pw: string | null) {
    setPhase({ name: "checking" });
    try {
      const p = await parseBackupText(content, pw);
      setParsed(p);
      if (p.preview.newerSchema) setMode("replace");
      setPhase({ name: "preview" });
    } catch (e) {
      if (e instanceof BackupError && e.code === "password") {
        setPhase({ name: "password", error: pw ? e.message : null });
        return;
      }
      setPhase({ name: "failed", message: e instanceof Error ? e.message : String(e), canRetry: false });
    }
  }

  async function run() {
    if (!parsed) return;
    setPhase({ name: "restoring", step: "safety" });
    try {
      const result = await restoreParsed(parsed, mode, (step) => setPhase({ name: "restoring", step }));
      setPhase({ name: "done", result, counts: countsOf(loadDb()) });
    } catch (e) {
      setPhase({ name: "failed", message: e instanceof Error ? e.message : String(e), canRetry: true });
    }
  }

  const idx = stepIndex(phase.name);
  const encrypted = inspection?.status === "backup" && inspection.encrypted;

  return (
    <Dialog open={open} onClose={close} title="Restaurar copia de seguridad" size="md">
      <div className="space-y-4">
        {/* Progreso */}
        <ol className="flex gap-1 text-[11px]" aria-label="Pasos de la restauración">
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1 min-w-0" aria-current={i === idx ? "step" : undefined}>
              <div className={cn("h-1.5 rounded-full", i < idx ? "bg-success" : i === idx ? "bg-primary" : "bg-muted")} />
              <span className={cn("block truncate mt-1", i === idx ? "text-text font-medium" : "text-subtle")}>{s}</span>
            </li>
          ))}
        </ol>

        {phase.name === "select" && (
          <div className="space-y-3">
            {origin === "other-device" ? (
              <div className="rounded-lg bg-muted p-3 text-sm space-y-1.5">
                <p className="font-medium">Traer tus datos desde otro dispositivo</p>
                <ol className="list-decimal pl-5 space-y-1 text-subtle">
                  <li>
                    En el dispositivo original: <strong>Configuración › Copias de seguridad y restauración › Descargar copia de seguridad</strong>.
                  </li>
                  <li>Pasa el archivo a este dispositivo (USB, correo, nube, AirDrop…).</li>
                  <li>Elígelo aquí abajo. Si lo descargaste sin cifrar, no te pedirá contraseña.</li>
                </ol>
              </div>
            ) : origin === "detected" ? (
              <p className="text-sm">Ese archivo es una copia de seguridad. Sigue estos pasos para restaurarla en este dispositivo.</p>
            ) : null}
            <p className="text-sm">Selecciona el archivo de copia de seguridad que deseas restaurar.</p>
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void load(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center cursor-pointer",
                dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
              )}
            >
              <FileUp size={26} className="text-subtle" />
              <span className="font-medium">Elegir archivo de copia…</span>
              <span className="text-xs text-subtle">o arrástralo aquí · .json o .gtbackup</span>
              <input
                ref={inputRef}
                type="file"
                accept=".json,.gtbackup,application/json"
                className="sr-only"
                aria-label="Archivo de copia de seguridad"
                onChange={(e) => {
                  void load(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <p className="text-xs text-subtle">Tus datos actuales no se modifican hasta que confirmes la restauración.</p>
          </div>
        )}

        {phase.name === "checking" && (
          <div className="py-6 text-center space-y-2">
            <Loader2 className="mx-auto animate-spin text-primary" size={26} />
            <p className="text-sm">Comprobando el archivo…</p>
          </div>
        )}

        {phase.name === "password" && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (text && password) void validate(text, password);
            }}
          >
            <Notice tone="info" icon={<Lock size={16} />}>
              <strong>Copia cifrada detectada.</strong> Introduce la contraseña utilizada al crearla.
              {inspection?.status === "backup" && <span className="block text-xs text-subtle mt-1">{inspection.formatLabel} · creada el {fmtDate(inspection.createdAt)}</span>}
            </Notice>
            {phase.error && (
              <Notice tone="danger" icon={<XCircle size={16} />}>
                {phase.error}
              </Notice>
            )}
            <Field label="Contraseña de la copia">
              <Input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setPhase({ name: "select" })}>
                Elegir otro archivo
              </Button>
              <Button type="submit" disabled={!password}>
                <KeyRound size={15} /> Descifrar y continuar
              </Button>
            </div>
          </form>
        )}

        {phase.name === "preview" && parsed && (
          <div className="space-y-3">
            {origin === "detected" && (
              <p className="text-sm">
                Has elegido una <strong>copia de seguridad</strong>: este asistente te guía para restaurarla en este dispositivo. También lo encuentras en
                Configuración › Copias de seguridad y restauración.
              </p>
            )}
            <Notice tone="success" icon={<ShieldCheck size={16} />}>
              <strong>Copia válida.</strong> Revisa los datos antes de restaurarlos.
            </Notice>
            {encrypted ? (
              <p className="text-xs text-subtle flex items-center gap-1.5">
                <Lock size={13} /> Copia cifrada: contraseña correcta.
              </p>
            ) : (
              <Notice tone="info" icon={<LockOpen size={16} />}>
                Copia sin cifrado detectada. No necesitas introducir una contraseña. Recuerda que cualquiera con este archivo puede leer tus datos:
                guárdalo en un lugar seguro.
              </Notice>
            )}
            <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
              <p className="break-all">
                <strong>Archivo:</strong> {fileName}
              </p>
              <p>
                <strong>Creada:</strong> {fmtDate(parsed.preview.exportedAt)}
                {parsed.preview.device && ` en «${parsed.preview.device}»`}
              </p>
              <p className="flex flex-wrap items-center gap-1.5">
                <strong>Formato:</strong> {inspection?.status === "backup" ? inspection.formatLabel : parsed.preview.format} · datos v{parsed.preview.schemaVersion}
                {parsed.preview.checksumVerified ? <Badge color="#16a34a">Integridad verificada</Badge> : <Badge>Formato anterior sin suma de comprobación</Badge>}
              </p>
              <p className="pt-1 font-medium">Se recuperará:</p>
              <ul className="grid grid-cols-2 gap-x-4 text-xs">
                {Object.entries(parsed.preview.counts).map(([k, v]) => (
                  <li key={k}>
                    {k}: <strong>{v}</strong>
                  </li>
                ))}
                <li>
                  Adjuntos de notas: <strong>{parsed.preview.files}</strong>
                </li>
                <li>Ajustes compartidos</li>
              </ul>
              {parsed.preview.missingFiles > 0 && <p className="text-xs text-warning">Faltaban {parsed.preview.missingFiles} adjuntos al crear la copia.</p>}
              {parsed.preview.newerSchema && (
                <p className="text-xs text-warning">La copia es de una versión más nueva de la app: se conservarán todos sus campos, pero conviene actualizar la app.</p>
              )}
            </div>

            <div className="grid gap-2" role="radiogroup" aria-label="Modo de restauración">
              <ModeOption
                active={mode === "replace"}
                onClick={() => {
                  setMode("replace");
                  setAck(false);
                }}
                title="Reemplazar datos actuales"
                desc="Los datos de este dispositivo se sustituyen por los de la copia. Tu PIN y tu tema se conservan."
              />
              <ModeOption
                active={mode === "merge"}
                disabled={parsed.preview.newerSchema}
                onClick={() => {
                  setMode("merge");
                  setAck(false);
                }}
                title="Combinar datos"
                desc={
                  parsed.preview.newerSchema
                    ? "No disponible: la copia es de una versión más nueva y combinar podría mezclar datos que esta versión no entiende."
                    : "Se añade lo que falta; si un registro está en ambos (mismo identificador), se conserva la versión editada más recientemente. No se borra nada ni se duplica."
                }
              />
            </div>
            {mode === "replace" && (
              <Notice tone="warning" icon={<AlertTriangle size={16} />}>
                La restauración <strong>reemplazará</strong> los datos que tienes ahora en este dispositivo.
              </Notice>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>
                Entiendo lo que va a pasar. Antes de cambiar nada se creará y verificará automáticamente una copia de seguridad de mis datos actuales.
              </span>
            </label>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setPhase({ name: "select" })}>
                Elegir otro archivo
              </Button>
              <Button variant={mode === "replace" ? "danger" : "primary"} disabled={!ack} onClick={run}>
                <ArchiveRestore size={15} /> Restaurar
              </Button>
            </div>
          </div>
        )}

        {phase.name === "restoring" && (
          <ul className="space-y-2 py-2 text-sm" aria-live="polite">
            {(
              [
                ["safety", "Creando una copia de seguridad de tus datos actuales"],
                ["files", "Recuperando archivos adjuntos"],
                ["apply", "Restaurando los datos"],
                ["verify", "Verificando la restauración"],
              ] as [RestoreStep, string][]
            ).map(([k, label], i, all) => {
              const cur = all.findIndex(([s]) => s === phase.step);
              return (
                <li key={k} className="flex items-center gap-2">
                  {i < cur ? <CheckCircle2 size={16} className="text-success" /> : i === cur ? <Loader2 size={16} className="animate-spin text-primary" /> : <span className="h-4 w-4 rounded-full border border-border" />}
                  <span className={i > cur ? "text-subtle" : ""}>{label}</span>
                </li>
              );
            })}
          </ul>
        )}

        {phase.name === "done" && (
          <div className="space-y-3">
            <Notice tone="success" icon={<CheckCircle2 size={16} />}>
              <strong>Restauración completada correctamente.</strong>{" "}
              {phase.result.mode === "merge" ? `Se añadieron ${phase.result.added} registros y se actualizaron ${phase.result.updated}.` : "Tus datos se han sustituido por los de la copia."}
            </Notice>
            <p className="text-sm">
              Se ha creado una copia de seguridad de tus datos anteriores ({fmtDate(phase.result.safetyBackup.at)}). Si hace falta, puedes volver a ella desde
              «Ver historial de copias».
            </p>
            {phase.result.filesRestored > 0 && <p className="text-sm">Adjuntos recuperados: {phase.result.filesRestored}.</p>}
            {phase.result.filesFailed > 0 && <p className="text-sm text-warning">{phase.result.filesFailed} adjuntos no se pudieron recuperar (el archivo estaba dañado).</p>}
            <div className="rounded-lg bg-muted p-3 text-xs">
              <p className="font-medium mb-1">Ahora tienes en este dispositivo:</p>
              <ul className="grid grid-cols-2 gap-x-4">
                {Object.entries(phase.counts).map(([k, v]) => (
                  <li key={k}>
                    {k}: <strong>{v}</strong>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                Cerrar
              </Button>
              <Button
                onClick={() => {
                  close();
                  navigate("/");
                }}
              >
                Ver mis datos
              </Button>
            </div>
          </div>
        )}

        {phase.name === "failed" && (
          <div className="space-y-3">
            <Notice tone="danger" icon={<XCircle size={16} />}>
              <strong>No se pudo restaurar el archivo. Tus datos actuales no se han modificado.</strong>
              <span className="block mt-1">{phase.message}</span>
            </Notice>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setPhase({ name: "select" })}>
                Elegir otro archivo
              </Button>
              {phase.canRetry && parsed && (
                <Button onClick={() => setPhase({ name: "preview" })}>
                  <RotateCcw size={15} /> Volver a intentarlo
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Notice({ tone, icon, children }: { tone: "info" | "success" | "warning" | "danger"; icon: React.ReactNode; children: React.ReactNode }) {
  const cls = {
    info: "border-primary/30 bg-primary/5",
    success: "border-success/40 bg-success/10",
    warning: "border-warning/40 bg-warning/10",
    danger: "border-danger/40 bg-danger/10",
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex gap-2 rounded-lg border p-3 text-sm ${cls}`}>
      <span className="shrink-0 mt-0.5">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ModeOption({ active, disabled, onClick, title, desc }: { active: boolean; disabled?: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "text-left rounded-lg border p-3 disabled:opacity-60 disabled:cursor-not-allowed",
        active ? "border-primary ring-1 ring-primary" : "border-border hover:bg-muted"
      )}
    >
      <span className="text-sm font-medium block">{title}</span>
      <span className="text-xs text-subtle">{desc}</span>
    </button>
  );
}
