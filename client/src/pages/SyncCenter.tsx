import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArchiveRestore,
  CheckCircle2,
  Cloud,
  CloudOff,
  Download,
  FileLock2,
  HardDrive,
  History,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { PlanReview } from "@/components/syncui/PlanReview";
import { useSyncCenter } from "@/store/syncCenter";
import { readPickedFile, saveFile, stampForFile, wasSaved } from "@/lib/share";
import { inspectBackupText, markDownloaded } from "@/services/backup/backup";
import { useRestoreWizard } from "@/store/restoreWizard";
import { storageEstimate, storageKind, listRestorePoints, type RestorePoint } from "@/services/storage";
import {
  commitPlan,
  createOffer,
  getSelf,
  openFile,
  pendingFor,
  planIncoming,
  receiveAnswer,
  removeDevice,
  rollbackTo,
  sealBackup,
  sealFile,
  setDeviceName,
  syncLog,
  type PairedDevice,
  type SyncLogEntry,
} from "@/services/manualsync/session";
import type { ChangeItem, DeviceRef, Plan, Resolution, SyncSummary } from "@/services/manualsync/engine";
import { COLLECTION_LABEL } from "@/services/manualsync/keyspace";
import { cn } from "@/lib/utils";

type Review = { plan: Plan; password: string };

function when(iso: string | null | undefined) {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
}

const MB = (n: number | null) => (n === null ? "—" : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function SyncCenter() {
  const { devices, pending, refresh } = useSyncCenter();
  const [self, setSelf] = useState<DeviceRef | null>(null);
  const [storage, setStorage] = useState<{ persisted: boolean | null; usage: number | null; quota: number | null } | null>(null);
  const [log, setLog] = useState<SyncLogEntry[]>([]);
  const [points, setPoints] = useState<RestorePoint[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ summary: SyncSummary; warnings: string[]; peer: string; followUp?: string } | null>(null);

  async function reload() {
    setSelf(await getSelf());
    setStorage(await storageEstimate());
    setLog(await syncLog());
    setPoints(await listRestorePoints());
    await refresh();
  }

  useEffect(() => {
    void reload();
    const onApplied = () => void reload();
    window.addEventListener("gt:sync-applied", onApplied);
    return () => window.removeEventListener("gt:sync-applied", onApplied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastOk = log.find((l) => l.status === "ok");

  async function confirmReview(res: Record<string, Resolution>) {
    if (!review) return;
    setBusy(true);
    try {
      const { answer, warnings } = await commitPlan(review.plan, res, "archivo");
      const file = await sealFile(answer, review.password);
      const answerName = `respuesta-para-${slug(review.plan.offer.from.name)}-${stampForFile()}.gtsync`;
      // Los cambios ya se aplicaron aquí: el archivo de respuesta es imprescindible
      // para el otro dispositivo, así que si se cancela se vuelve a pedir una vez.
      if (!wasSaved(await saveFile(answerName, JSON.stringify(file))) && !wasSaved(await saveFile(answerName, JSON.stringify(file)))) {
        toast.error("Los cambios se aplicaron, pero el archivo de respuesta no se guardó. Repite la sincronización desde el otro dispositivo.", { duration: 10000 });
      }
      setResult({
        summary: answer.summary,
        warnings,
        peer: review.plan.offer.from.name,
        followUp: `Para terminar, importa el archivo de respuesta en «${review.plan.offer.from.name}» (Sincronización → Importar archivo) con la misma contraseña.`,
      });
      setReview(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 8000 });
    } finally {
      setBusy(false);
      void reload();
    }
  }

  function cancelReview() {
    setReview(null);
  }

  return (
    <>
      <PageHeader title="Sincronización" description="Tus datos viven en este dispositivo. Pásalos a otro dispositivo con un archivo cifrado, solo cuando tú quieras." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Estado */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive size={16} /> Este dispositivo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DeviceName self={self} onSaved={reload} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <dt className="text-subtle">Almacenamiento</dt>
              <dd>{storageKind() === "indexeddb" ? "Local (IndexedDB)" : "Local (básico)"}</dd>
              <dt className="text-subtle">Protegido contra borrado</dt>
              <dd className={storage?.persisted ? "text-success" : "text-warning"}>
                {storage?.persisted === null ? "No disponible" : storage?.persisted ? "Sí" : "No garantizado"}
              </dd>
              <dt className="text-subtle">Espacio usado</dt>
              <dd>
                {MB(storage?.usage ?? null)}
                {storage?.quota ? ` de ${MB(storage.quota)}` : ""}
              </dd>
              <dt className="text-subtle">Última sincronización</dt>
              <dd>{lastOk ? `${when(lastOk.at)} · ${lastOk.peerName}` : "nunca"}</dd>
              <dt className="text-subtle">Cambios sin sincronizar</dt>
              <dd className={pending ? "text-warning font-medium" : ""}>{pending === null ? "—" : pending}</dd>
            </dl>
            {!storage?.persisted && (
              <p className="text-xs text-subtle">
                Consejo: instala la app en la pantalla de inicio y exporta copias de seguridad de vez en cuando.
              </p>
            )}
          </CardContent>
        </Card>

        <FileSync devices={devices} onPlan={(plan, password) => setReview({ plan, password })} onDone={reload} onResult={setResult} />

        <Devices devices={devices} onChanged={reload} />

        <Pending devices={devices} />

        <Backups points={points} onChanged={reload} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History size={16} /> Historial
            </CardTitle>
          </CardHeader>
          <CardContent>
            {log.length === 0 ? (
              <p className="text-sm text-subtle">Aún no se ha sincronizado nada.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {log.slice(0, 15).map((l) => (
                  <li key={l.id} className="py-2 flex items-start gap-2">
                    {l.status === "ok" ? <CheckCircle2 size={15} className="text-success mt-0.5 shrink-0" /> : <CloudOff size={15} className="text-danger mt-0.5 shrink-0" />}
                    <div className="min-w-0">
                      <div>
                        {l.peerName} · {l.method === "red" ? "Wi‑Fi (retirada)" : "archivo"}
                      </div>
                      <div className="text-xs text-subtle">
                        {when(l.at)}
                        {l.summary && ` · ${l.summary.received} recibidos · ${l.summary.sent} enviados · ${l.summary.conflicts} conflictos`}
                        {l.message && ` · ${l.message}`}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!review} onClose={() => !busy && cancelReview()} title="Revisa la sincronización" description="Nada se aplica hasta que confirmes." size="lg">
        {review && self && (
          <PlanReview
            plan={review.plan}
            peerName={review.plan.offer.from.name}
            selfName={self.name}
            busy={busy}
            onConfirm={confirmReview}
            onCancel={cancelReview}
          />
        )}
      </Dialog>

      <Dialog open={!!result} onClose={() => setResult(null)} title="Sincronización completada">
        {result && (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 text-success">
              <CheckCircle2 size={18} /> Con «{result.peer}»
            </p>
            <ul className="space-y-1">
              <li>{result.summary.received} cambio(s) recibidos</li>
              <li>{result.summary.sent} cambio(s) enviados</li>
              <li>{result.summary.conflicts} conflicto(s) resueltos por ti</li>
              {result.summary.autoResolved > 0 && <li>{result.summary.autoResolved} resueltos automáticamente sin riesgo</li>}
            </ul>
            {result.warnings.map((w) => (
              <p key={w} className="text-xs text-warning">
                {w}
              </p>
            ))}
            {result.followUp && <p className="text-sm font-medium">{result.followUp}</p>}
            <Button className="w-full h-11" onClick={() => setResult(null)}>
              Entendido
            </Button>
          </div>
        )}
      </Dialog>
    </>
  );
}

function slug(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

/* --------------------------------------------------------------- nombre */

function DeviceName({ self, onSaved }: { self: DeviceRef | null; onSaved: () => void }) {
  const [v, setV] = useState("");
  useEffect(() => setV(self?.name ?? ""), [self?.name]);
  return (
    <form
      className="flex gap-2 items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        await setDeviceName(v);
        toast.success("Nombre guardado");
        onSaved();
      }}
    >
      <div className="flex-1">
        <Field label="Nombre de este dispositivo">
          <Input value={v} maxLength={40} onChange={(e) => setV(e.target.value)} />
        </Field>
      </div>
      <Button type="submit" variant="outline" disabled={!v.trim() || v === self?.name}>
        Guardar
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------ archivos */

function FileSync({
  devices,
  onPlan,
  onDone,
  onResult,
}: {
  devices: PairedDevice[];
  onPlan: (p: Plan, password: string) => void;
  onDone: () => void;
  onResult: (r: { summary: SyncSummary; warnings: string[]; peer: string }) => void;
}) {
  const [target, setTarget] = useState("__new");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [importPw, setImportPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingPkg, setPendingPkg] = useState<{ file: File; text: string } | null>(null);
  const openWizard = useRestoreWizard((st) => st.openWizard);
  const fileRef = useRef<HTMLInputElement>(null);

  async function exportPackage() {
    if (password.length < 8) return toast.error("La contraseña debe tener al menos 8 caracteres");
    if (password !== password2) return toast.error("Las contraseñas no coinciden");
    setBusy(true);
    try {
      const peer = target === "__new" ? null : target;
      const offer = await createOffer(peer, { full: peer === null });
      const file = await sealFile(offer, password);
      const name = devices.find((d) => d.deviceId === peer)?.name ?? "nuevo-dispositivo";
      if (!wasSaved(await saveFile(`sincronizacion-para-${slug(name)}-${stampForFile()}.gtsync`, JSON.stringify(file)))) return;
      toast.success(`Paquete creado (${offer.entries.length} elemento(s)). Impórtalo en el otro dispositivo.`, { duration: 6000 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Primero se DETECTA qué es el archivo (sin contraseña). Una copia de
   * seguridad abre directamente el asistente de restauración; un paquete de
   * sincronización cifrado pide su contraseña y conserva el archivo elegido.
   * Antes el botón exigía contraseña siempre y, si era una copia, solo decía
   * «restáurala» sin llevar a ningún sitio.
   */
  async function importPicked(file: File) {
    setBusy(true);
    try {
      const text = await readPickedFile(file);
      const kind = inspectBackupText(text);
      if (kind.status === "backup") {
        openWizard({ file, origin: "detected" });
        return;
      }
      if (kind.status !== "sync-package") {
        toast.error(kind.reason, { duration: 8000 });
        return;
      }
      if (kind.encrypted && !importPw) {
        setPendingPkg({ file, text });
        return;
      }
      await applyPackage(text, importPw);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  async function applyPackage(text: string, pw: string) {
    const { kind, payload } = await openFile(text, pw);
    setPendingPkg(null);
    if (kind === "offer") {
      const plan = await planIncoming(payload);
      onPlan(plan, pw);
    } else if (kind === "answer") {
      const summary = await receiveAnswer(payload, "archivo");
      onResult({ summary, warnings: [], peer: (payload as { from: DeviceRef }).from.name });
      onDone();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileLock2 size={16} /> Sincronizar con archivo cifrado
        </CardTitle>
        <CardDescription>
          Exporta un paquete aquí, ábrelo en el otro dispositivo (AirDrop, iCloud Drive, correo, USB…) y devuelve el archivo de respuesta.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">1. Exportar mis cambios</p>
          <Field label="Para">
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="__new">Un dispositivo nuevo (paquete completo)</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.name} (solo cambios)
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label="Contraseña" hint="Mínimo 8 caracteres. Usa la misma en el otro dispositivo.">
              <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Repite la contraseña">
              <Input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} className={password2 && password2 !== password ? "border-danger" : ""} />
            </Field>
          </div>
          <Button onClick={exportPackage} loading={busy} className="w-full sm:w-auto h-11">
            <Upload size={15} /> Exportar paquete de sincronización
          </Button>
        </div>
        <div className="space-y-2 pt-4 border-t border-border">
          <p className="text-sm font-medium">2. Importar un paquete o una respuesta</p>
          <Field label="Contraseña del paquete" hint="La que se usó al exportarlo. Si eliges una copia de seguridad, se abrirá su propio asistente.">
            <Input type="password" autoComplete="current-password" value={importPw} onChange={(e) => setImportPw(e.target.value)} />
          </Field>
          {pendingPkg && (
            <div role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm space-y-2">
              <p>
                <strong>Paquete cifrado detectado</strong> («{pendingPkg.file.name}»). Escribe arriba su contraseña y pulsa «Abrir paquete».
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!importPw || busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await applyPackage(pendingPkg.text, importPw);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : String(e), { duration: 8000 });
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Abrir paquete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPendingPkg(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy} className="w-full sm:w-auto h-11">
            <Download size={15} /> Elegir archivo…
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".gtsync,.gtbackup,.json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void importPicked(f);
            }}
          />
          <p className="text-xs text-subtle">
            Al importar un paquete verás qué cambia y los conflictos antes de aplicar nada. Después se genera un archivo de respuesta para el otro dispositivo.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------- dispositivos */

function Devices({ devices, onChanged }: { devices: PairedDevice[]; onChanged: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck size={16} /> Dispositivos sincronizados
        </CardTitle>
      </CardHeader>
      <CardContent>
        {devices.length === 0 ? (
          <p className="text-sm text-subtle">Ninguno todavía.</p>
        ) : (
          <ul className="divide-y divide-border">
            {devices.map((d) => (
              <li key={d.deviceId} className="py-2 flex items-center gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{d.name}</div>
                  <div className="text-xs text-subtle">
                    Primera sincronización {when(d.pairedAt)} · última {when(d.lastSyncAt)}
                  </div>
                </div>
                <button
                  className="p-2.5 rounded-md text-subtle hover:text-danger hover:bg-muted"
                  aria-label={`Olvidar ${d.name}`}
                  onClick={async () => {
                    if (!confirm(`¿Olvidar «${d.name}»? La próxima sincronización con él será completa. Los datos no se borran.`)) return;
                    await removeDevice(d.deviceId);
                    toast.success("Dispositivo olvidado");
                    onChanged();
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------ pendientes */

function Pending({ devices }: { devices: PairedDevice[] }) {
  const [peer, setPeer] = useState<string>("");
  const [items, setItems] = useState<ChangeItem[] | null>(null);
  useEffect(() => {
    if (!peer && devices[0]) setPeer(devices[0].deviceId);
  }, [devices, peer]);
  useEffect(() => {
    if (!peer) return;
    void pendingFor(peer).then(setItems);
  }, [peer]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud size={16} /> Cambios pendientes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {devices.length === 0 ? (
          <p className="text-subtle">Sincroniza por archivo con un dispositivo para ver qué falta por enviarle.</p>
        ) : (
          <>
            <Select aria-label="Respecto a" value={peer} onChange={(e) => setPeer(e.target.value)}>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  Respecto a {d.name}
                </option>
              ))}
            </Select>
            {items && items.length === 0 && <p className="text-success flex items-center gap-2"><CheckCircle2 size={15} /> Nada pendiente.</p>}
            {items && items.length > 0 && (
              <ul className="max-h-64 overflow-y-auto divide-y divide-border">
                {items.slice(0, 100).map((i) => (
                  <li key={i.key} className="py-1.5 flex gap-2">
                    <Badge className={cn(i.kind === "delete" && "text-danger")}>{i.kind === "new" ? "Nuevo" : i.kind === "update" ? "Editado" : "Borrado"}</Badge>
                    <span className="truncate">
                      <span className="text-subtle text-xs">{COLLECTION_LABEL[i.collection] ?? i.collection} · </span>
                      {i.label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------- copias */

function Backups({ points, onChanged }: { points: RestorePoint[]; onChanged: () => void }) {
  const [pw, setPw] = useState("");
  const [plain, setPlain] = useState(true);
  const openWizard = useRestoreWizard((st) => st.openWizard);

  async function exportNow() {
    if (!plain && pw.length < 8) return toast.error("Contraseña de al menos 8 caracteres, o deja marcada «sin cifrar»");
    const text = await sealBackup(plain ? null : pw);
    if (!wasSaved(await saveFile(`copia-productividad-${stampForFile()}${plain ? "" : ".cifrada"}.json`, text))) return;
    markDownloaded(text.length);
    toast.success(plain ? "Copia exportada sin cifrar: se restaura sin contraseña" : "Copia cifrada exportada: necesitarás la contraseña para restaurarla");
  }

  return (
    <Card className="lg:col-span-2" id="copias-sync">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArchiveRestore size={16} /> Copias de seguridad
        </CardTitle>
        <CardDescription>
          También en <Link to="/configuracion#copias" className="underline">Configuración › Copias de seguridad y restauración</Link>, con el historial y más opciones.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-2">
          <p className="text-sm font-medium">Exportar copia completa</p>
          <label className="flex items-center gap-2 text-xs text-subtle min-h-[36px]">
            <input type="checkbox" className="accent-primary h-4 w-4" checked={plain} onChange={(e) => setPlain(e.target.checked)} />
            Sin cifrar (se restaura sin contraseña; cualquiera con el archivo podrá leerlo)
          </label>
          {!plain && (
            <Field label="Contraseña" hint="Mínimo 8 caracteres. Sin ella no se podrá restaurar.">
              <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
          )}
          <Button onClick={exportNow} className="w-full h-11">
            <Download size={15} /> Exportar copia
          </Button>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Restaurar una copia</p>
          <p className="text-xs text-subtle">
            Elige el archivo y la app detecta sola si está cifrado: solo entonces te pedirá la contraseña. Verás qué contiene antes de restaurar.
          </p>
          <Button variant="outline" className="w-full h-11" onClick={() => openWizard({ origin: "settings" })}>
            <Upload size={15} /> Restaurar copia de seguridad…
          </Button>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Puntos de restauración automáticos</p>
          <p className="text-xs text-subtle">Se crean antes de sincronizar, restaurar o actualizar los datos.</p>
          {points.length === 0 ? (
            <p className="text-sm text-subtle">Ninguno todavía.</p>
          ) : (
            <ul className="divide-y divide-border text-sm max-h-60 overflow-y-auto">
              {points.map((p) => (
                <li key={p.id} className="py-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{p.reason}</div>
                    <div className="text-xs text-subtle">{when(p.at)}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!confirm(`¿Volver al estado de «${p.reason}» (${when(p.at)})? Lo actual se guardará antes como otro punto de restauración.`)) return;
                      await rollbackTo(p.id);
                      toast.success("Datos restaurados");
                      onChanged();
                    }}
                  >
                    Volver aquí
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>

    </Card>
  );
}

