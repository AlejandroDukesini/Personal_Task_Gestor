import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, Crop as CropIcon, ImageUp, Loader2, ShieldCheck, X } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Field, Input, Select } from "@/components/ui/Input";
import { Progress } from "@/components/ui/Progress";
import { api } from "@/services/api";
import { localDateKey } from "@/services/localDb";
import { parseCalendarText, type CalendarView, type DetectedEvent } from "@/services/screenshot/parse";
import { matchHabits, type HabitMatch } from "@/services/screenshot/match";
import {
  ImageValidationError,
  OCR_CDN,
  checkDimensions,
  imageToCanvas,
  recognize,
  sampleColor,
  sha256Hex,
  validateImageFile,
  wipeCanvas,
  type Crop,
} from "@/services/screenshot/ocr";
import type { Habit } from "@/types";
import { cn } from "@/lib/utils";

const CONSENT_KEY = "gestion-tareas:ocr-consent";
const NEW = "__new";
const IGNORE = "__ignore";

type Step = "pick" | "adjust" | "analyzing" | "review";

interface Row extends DetectedEvent {
  include: boolean;
  /** habitId | NEW | IGNORE | "" (sin elegir). */
  choice: string;
  newName: string;
  action: "scheduled" | "done";
  addSchedule: boolean;
  count: number;
  matchKind: "match" | "ambiguous" | "none";
  candidates: HabitMatch[];
  already: { action: string; counted: number } | null;
}

function readConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function ScreenshotImport({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [step, setStep] = useState<Step>("pick");
  const [image, setImage] = useState<{ bitmap: ImageBitmap; url: string; hash: string; name: string } | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [refDate, setRefDate] = useState(localDateKey());
  const [view, setView] = useState<CalendarView | "auto">("auto");
  const [consent, setConsent] = useState(readConsent);
  const [progress, setProgress] = useState({ p: 0, status: "" });
  const [rows, setRows] = useState<Row[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [previousImport, setPreviousImport] = useState<number>(0);
  const [applying, setApplying] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const cancelled = useRef(false);

  /** Libera la imagen: no queda en memoria ni en ningún almacenamiento. */
  const reset = useCallback(() => {
    cancelled.current = true;
    setImage((img) => {
      if (img) {
        URL.revokeObjectURL(img.url);
        img.bitmap.close();
      }
      return null;
    });
    setCrop(null);
    setRows([]);
    setWarnings([]);
    setStep("pick");
    setProgress({ p: 0, status: "" });
    setPreviousImport(0);
  }, []);

  useEffect(() => {
    if (!open) reset();
    else api.get<Habit[]>("/habits").then(setHabits).catch(() => setHabits([]));
  }, [open, reset]);

  async function loadFile(file: File | undefined | null) {
    if (!file) return;
    try {
      const { bytes } = await validateImageFile(file);
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
      try {
        checkDimensions(bitmap.width, bitmap.height);
      } catch (e) {
        bitmap.close();
        throw e;
      }
      const hash = await sha256Hex(bytes);
      const prev = await api.get<unknown[]>(`/habit-imports?imageHash=${hash}`);
      setPreviousImport(prev.length);
      setImage((old) => {
        if (old) {
          URL.revokeObjectURL(old.url);
          old.bitmap.close();
        }
        return { bitmap, url: URL.createObjectURL(file), hash, name: file.name };
      });
      setCrop(null);
      setStep("adjust");
    } catch (e: any) {
      toast.error(e instanceof ImageValidationError ? e.message : "No se pudo abrir la imagen. ¿Es una captura válida?");
    }
  }

  async function analyze() {
    if (!image) return;
    if (!consent) {
      toast.error("Acepta el aviso de procesamiento para continuar");
      return;
    }
    try {
      localStorage.setItem(CONSENT_KEY, "1");
    } catch {
      /* sin almacenamiento */
    }
    cancelled.current = false;
    setStep("analyzing");
    setProgress({ p: 0, status: "Preparando la imagen…" });
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = await imageToCanvas(image.bitmap, crop);
      const out = await recognize(canvas, (p, status) => setProgress({ p, status: statusLabel(status) }));
      if (cancelled.current) return;
      const parsed = parseCalendarText(out.lines, { referenceDate: refDate, view, imageWidth: out.width });
      for (const ev of parsed.events) ev.color = sampleColor(canvas, ev.bbox);
      const draft: Row[] = parsed.events.map((ev) => {
        const m = matchHabits(ev, habits as any);
        const choice = m.kind === "match" ? m.habitId : m.kind === "none" ? IGNORE : "";
        return {
          ...ev,
          include: !!ev.title && !!ev.date && ev.confidence >= 0.4,
          choice,
          newName: ev.title,
          action: "scheduled",
          addSchedule: false,
          count: 1,
          matchKind: m.kind,
          candidates: m.candidates,
          already: null,
        };
      });
      // ¿Alguno ya se importó antes? (misma captura o mismo evento)
      const checkable = draft.map((r) => ({ title: r.title || "?", date: r.date ?? "1970-01-01", startTime: r.startTime, habitId: r.choice && r.choice !== NEW && r.choice !== IGNORE ? r.choice : null }));
      const prev = await api.post<({ action: string; counted: number } | null)[]>("/habit-imports/check", { items: checkable });
      draft.forEach((r, i) => {
        r.already = prev[i];
        if (prev[i]) r.include = false;
      });
      setRows(draft);
      setWarnings(parsed.warnings);
      setStep("review");
    } catch (e: any) {
      if (cancelled.current) return;
      toast.error(
        /fetch|network|Failed to/i.test(String(e?.message))
          ? "No se pudo descargar el motor de reconocimiento. Revisa tu conexión e inténtalo de nuevo."
          : "No se pudo analizar la captura. Prueba a recortarla o con una imagen más nítida."
      );
      setStep("adjust");
    } finally {
      wipeCanvas(canvas);
    }
  }

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function problemOf(r: Row): string | null {
    if (!r.include) return null;
    if (r.choice === "") return "Elige el hábito (hay varias coincidencias)";
    if (r.choice === IGNORE) return null;
    if (!r.title.trim()) return "Escribe el nombre";
    if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return "Confirma la fecha";
    if (r.choice === NEW && !r.newName.trim()) return "Nombre del hábito nuevo";
    if (r.addSchedule && !r.startTime) return "Indica la hora para añadirla al horario";
    return null;
  }

  async function apply() {
    const chosen = rows.filter((r) => r.include);
    const bad = chosen.map(problemOf).find(Boolean);
    if (bad) {
      toast.error(bad);
      return;
    }
    if (chosen.length === 0) {
      toast("No hay eventos seleccionados");
      return;
    }
    const done = chosen.filter((r) => r.action === "done" && r.choice !== IGNORE).length;
    if (done && !confirm(`Vas a registrar ${done} realización(es) como hechas. ¿Confirmas que realizaste esas actividades?`)) return;
    setApplying(true);
    try {
      const items = chosen.map((r) => ({
        title: r.title.trim(),
        date: r.date ?? localDateKey(),
        startTime: r.startTime,
        endTime: r.endTime,
        habitId: r.choice !== NEW && r.choice !== IGNORE ? r.choice : null,
        createHabit: r.choice === NEW ? { name: r.newName.trim(), color: r.color ?? undefined } : null,
        action: r.choice === IGNORE ? "ignored" : r.action,
        addSchedule: r.choice !== IGNORE && r.addSchedule,
        count: r.count,
        confidence: r.confidence,
      }));
      const s = await api.post<{ imported: number; counted: number; scheduled: number; habitsCreated: number; skipped: number }>("/habit-imports/apply", {
        items,
        imageHash: image?.hash ?? null,
      });
      const parts = [
        `${s.imported} evento(s) importado(s)`,
        s.counted && `${s.counted} realización(es) registrada(s)`,
        s.scheduled && `${s.scheduled} horario(s) añadido(s)`,
        s.habitsCreated && `${s.habitsCreated} hábito(s) creado(s)`,
        s.skipped && `${s.skipped} ya importado(s) antes`,
      ].filter(Boolean);
      toast.success(parts.join(" · "));
      onImported();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo importar");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Importar desde captura de calendario" description="Reconoce los eventos de una captura de Google Calendar y propón su registro." size="lg">
      {step === "pick" && (
        <div className="space-y-4">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              loadFile(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors",
              dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
            )}
          >
            <ImageUp size={28} className="text-subtle" />
            <span className="font-medium">Elige una captura o arrástrala aquí</span>
            <span className="text-xs text-subtle">PNG, JPG o JPEG · máx. 10 MB</span>
            <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => loadFile(e.target.files?.[0])} />
          </label>
          <PrivacyNote />
        </div>
      )}

      {step === "adjust" && image && (
        <div className="space-y-4">
          {previousImport > 0 && (
            <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertTriangle size={16} className="shrink-0 mt-0.5 text-warning" />
              Esta misma captura ya se importó ({previousImport} evento(s)). Los eventos ya importados no se duplicarán.
            </div>
          )}
          <CropArea url={image.url} natural={{ w: image.bitmap.width, h: image.bitmap.height }} crop={crop} onCrop={setCrop} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Fecha que muestra la captura" hint="El día visible o el primer día de la semana/agenda. Se usa para completar mes y año.">
              <Input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value || localDateKey())} />
            </Field>
            <Field label="Vista del calendario">
              <Select value={view} onChange={(e) => setView(e.target.value as CalendarView | "auto")}>
                <option value="auto">Detectar automáticamente</option>
                <option value="day">Día</option>
                <option value="week">Semana / varios días</option>
                <option value="agenda">Agenda / programación</option>
              </Select>
            </Field>
          </div>
          <label className="flex items-start gap-2 text-sm rounded-lg bg-muted p-3">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              Entiendo que la captura se analiza <strong>en este dispositivo</strong> y no se envía a ningún servidor. La primera vez se
              descargará el motor de reconocimiento de texto (unos MB) desde <code className="text-xs">{new URL(OCR_CDN).host}</code>.
            </span>
          </label>
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={reset}>
              <X size={14} /> Otra imagen
            </Button>
            <Button onClick={analyze} disabled={!consent}>
              Analizar eventos
            </Button>
          </div>
        </div>
      )}

      {step === "analyzing" && (
        <div className="space-y-3 py-6 text-center">
          <Loader2 className="mx-auto animate-spin text-primary" size={28} />
          <p className="text-sm font-medium">{progress.status || "Analizando…"}</p>
          <Progress value={progress.p * 100} />
          <p className="text-xs text-subtle">El análisis ocurre en tu dispositivo.</p>
          <Button
            variant="ghost"
            onClick={() => {
              cancelled.current = true;
              setStep("adjust");
            }}
          >
            Cancelar
          </Button>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-4">
          {warnings.map((w) => (
            <div key={w} className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertTriangle size={16} className="shrink-0 mt-0.5 text-warning" /> {w}
            </div>
          ))}
          <p className="text-sm text-subtle">
            Revisa cada evento. <strong>Un evento de agenda solo prueba que estaba programado</strong>: marca «Lo realicé» únicamente si
            de verdad lo hiciste.
          </p>

          <div className="space-y-3">
            {rows.map((r) => (
              <ReviewCard key={r.key} row={r} habits={habits} problem={problemOf(r)} onChange={(p) => update(r.key, p)} />
            ))}
          </div>

          <div className="flex flex-col-reverse sm:flex-row justify-between gap-2 pt-2">
            <Button variant="ghost" onClick={() => setStep("adjust")}>
              Volver a analizar
            </Button>
            <Button onClick={apply} loading={applying} disabled={!rows.some((r) => r.include)}>
              <CheckCircle2 size={15} /> Confirmar {rows.filter((r) => r.include).length} evento(s)
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function statusLabel(s: string): string {
  if (/loading tesseract core|loading language|initializ/i.test(s)) return "Preparando el motor de reconocimiento…";
  if (/recogniz/i.test(s)) return "Leyendo el texto de la captura…";
  return "Analizando…";
}

function PrivacyNote() {
  return (
    <div className="flex gap-2 text-xs text-subtle">
      <ShieldCheck size={16} className="shrink-0 text-success" />
      <p>
        La imagen se procesa localmente y nunca se guarda: al cerrar este asistente se descarta. Solo se guardan los eventos que confirmes
        (nombre, fecha y hora) y una huella de la imagen para no importarla dos veces. Si la captura muestra citas privadas, recórtala antes de
        analizarla.
      </p>
    </div>
  );
}

/** Vista previa con recorte por arrastre (ratón o dedo). */
function CropArea({ url, natural, crop, onCrop }: { url: string; natural: { w: number; h: number }; crop: Crop | null; onCrop: (c: Crop | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const [cropMode, setCropMode] = useState(false);

  const toNatural = (r: { x: number; y: number; x2: number; y2: number }): Crop | null => {
    const el = box.current;
    if (!el) return null;
    const k = natural.w / el.clientWidth;
    const x = Math.max(0, Math.min(r.x, r.x2) * k);
    const y = Math.max(0, Math.min(r.y, r.y2) * k);
    const w = Math.min(natural.w - x, Math.abs(r.x2 - r.x) * k);
    const h = Math.min(natural.h - y, Math.abs(r.y2 - r.y) * k);
    return w >= 200 && h >= 150 ? { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) } : null;
  };
  const pos = (e: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const shown = drag ?? (crop && box.current ? scaleToView(crop, natural.w / box.current.clientWidth) : null);

  return (
    <div className="space-y-2">
      <div
        ref={box}
        className={cn("relative rounded-lg overflow-hidden border border-border select-none", cropMode && "cursor-crosshair touch-none")}
        onPointerDown={(e) => {
          if (!cropMode) return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          const p = pos(e);
          setDrag({ x: p.x, y: p.y, x2: p.x, y2: p.y });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const p = pos(e);
          setDrag({ ...drag, x2: p.x, y2: p.y });
        }}
        onPointerUp={() => {
          if (!drag) return;
          const c = toNatural(drag);
          setDrag(null);
          if (c) {
            onCrop(c);
            setCropMode(false);
          } else toast("Recorte demasiado pequeño: selecciona una zona mayor");
        }}
      >
        <img src={url} alt="Vista previa de la captura" className="w-full max-h-[50vh] object-contain object-top bg-muted" draggable={false} />
        {shown && (
          <div
            className="absolute border-2 border-primary bg-primary/10 pointer-events-none"
            style={{ left: Math.min(shown.x, shown.x2), top: Math.min(shown.y, shown.y2), width: Math.abs(shown.x2 - shown.x), height: Math.abs(shown.y2 - shown.y) }}
          />
        )}
      </div>
      <div className="flex gap-2 items-center text-xs text-subtle">
        <Button type="button" size="sm" variant={cropMode ? "primary" : "outline"} onClick={() => setCropMode(!cropMode)}>
          <CropIcon size={13} /> {cropMode ? "Arrastra sobre la imagen…" : "Recortar"}
        </Button>
        {crop && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onCrop(null)}>
            Quitar recorte
          </Button>
        )}
        <span className="ml-auto">
          {crop ? `Recorte ${crop.w}×${crop.h}px` : `${natural.w}×${natural.h}px`}
        </span>
      </div>
    </div>
  );
}

function scaleToView(c: Crop, k: number) {
  return { x: c.x / k, y: c.y / k, x2: (c.x + c.w) / k, y2: (c.y + c.h) / k };
}

function confidenceBadge(c: number) {
  if (c >= 0.75) return <Badge color="#16a34a">Confianza alta · {Math.round(c * 100)} %</Badge>;
  if (c >= 0.45) return <Badge color="#d97706">Confianza media · {Math.round(c * 100)} %</Badge>;
  return <Badge color="#dc2626">Confianza baja · {Math.round(c * 100)} %</Badge>;
}

function ReviewCard({ row: r, habits, problem, onChange }: { row: Row; habits: Habit[]; problem: string | null; onChange: (p: Partial<Row>) => void }) {
  const candidateIds = new Set(r.candidates.map((c) => c.habitId));
  const others = habits.filter((h) => !candidateIds.has(h.id));
  const ignoring = r.choice === IGNORE;
  return (
    <div className={cn("rounded-lg border p-3 space-y-3", r.include ? "border-border" : "border-border opacity-60", problem && "border-danger")}>
      <div className="flex items-start gap-2">
        <input type="checkbox" className="mt-1.5" checked={r.include} onChange={(e) => onChange({ include: e.target.checked })} aria-label="Incluir en la importación" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {r.color && <span className="h-3 w-3 rounded-full" style={{ background: r.color }} aria-hidden />}
            {confidenceBadge(r.confidence)}
            {r.already && <Badge color="#6366f1">Ya importado ({r.already.action === "done" ? "registrado" : r.already.action === "ignored" ? "ignorado" : "programado"})</Badge>}
            {r.estimatedTime && <Badge>Hora estimada</Badge>}
          </div>
          {r.issues.length > 0 && <p className="text-xs text-subtle">{r.issues.join(" · ")}</p>}
          <p className="text-xs text-subtle truncate" title={r.raw}>
            Texto leído: «{r.raw}»
          </p>
        </div>
      </div>

      {r.include && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Field label="Nombre">
              <Input value={r.title} onChange={(e) => onChange({ title: e.target.value })} />
            </Field>
            <Field label="Fecha">
              <Input type="date" value={r.date ?? ""} onChange={(e) => onChange({ date: e.target.value || null })} />
            </Field>
            <Field label="Inicio">
              <Input type="time" value={r.startTime ?? ""} onChange={(e) => onChange({ startTime: e.target.value || null, estimatedTime: false })} />
            </Field>
            <Field label="Fin">
              <Input type="time" value={r.endTime ?? ""} onChange={(e) => onChange({ endTime: e.target.value || null })} />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label={r.matchKind === "ambiguous" ? "Hábito (varias coincidencias: elige)" : "Hábito relacionado"}>
              <Select value={r.choice} onChange={(e) => onChange({ choice: e.target.value })}>
                <option value="" disabled>
                  Elige un hábito…
                </option>
                {r.candidates.map((c) => (
                  <option key={c.habitId} value={c.habitId}>
                    {c.name} · {Math.round(c.score * 100)} %
                  </option>
                ))}
                {others.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
                <option value={NEW}>➕ Crear hábito nuevo</option>
                <option value={IGNORE}>Ignorar este evento</option>
              </Select>
            </Field>
            {r.choice === NEW ? (
              <Field label="Nombre del hábito nuevo">
                <Input value={r.newName} onChange={(e) => onChange({ newName: e.target.value })} />
              </Field>
            ) : (
              !ignoring && (
                <Field label="Acción">
                  <Select value={r.action} onChange={(e) => onChange({ action: e.target.value as Row["action"] })}>
                    <option value="scheduled">Solo estaba programado</option>
                    <option value="done">Lo realicé: registrar</option>
                  </Select>
                </Field>
              )
            )}
          </div>
          {r.choice === NEW && (
            <Field label="Acción">
              <Select value={r.action} onChange={(e) => onChange({ action: e.target.value as Row["action"] })}>
                <option value="scheduled">Solo estaba programado</option>
                <option value="done">Lo realicé: registrar</option>
              </Select>
            </Field>
          )}
          {!ignoring && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={r.addSchedule} onChange={(e) => onChange({ addSchedule: e.target.checked })} />
              Añadir este horario a la programación del hábito
            </label>
          )}
          {problem && <p className="text-xs text-danger">{problem}</p>}
        </>
      )}
    </div>
  );
}
