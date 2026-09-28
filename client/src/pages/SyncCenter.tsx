import { useEffect, useRef, useState } from "react";
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
  KeyRound,
  Laptop,
  Link2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  Wifi,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { PlanReview } from "@/components/syncui/PlanReview";
import { useSyncCenter } from "@/store/syncCenter";
import { readPickedFile, saveFile, stampForFile } from "@/lib/share";
import { storageEstimate, storageKind, listRestorePoints, type RestorePoint } from "@/services/storage";
import {
  commitPlan,
  createOffer,
  describeBackup,
  getSelf,
  openFile,
  pendingFor,
  planIncoming,
  receiveAnswer,
  removeDevice,
  restoreBackup,
  rollbackTo,
  sealBackup,
  sealFile,
  setDeviceName,
  syncLog,
  type BackupFile,
  type PairedDevice,
  type SyncLogEntry,
} from "@/services/manualsync/session";
import { pairWith, startNetworkSync, type NetworkSession } from "@/services/manualsync/network";
import type { ChangeItem, DeviceRef, Plan, Resolution, SyncSummary } from "@/services/manualsync/engine";
import { COLLECTION_LABEL } from "@/services/manualsync/keyspace";
import { cn } from "@/lib/utils";

type Review =
  | { kind: "network"; session: NetworkSession }
  | { kind: "file"; plan: Plan; password: string };

function when(iso: string | null | undefined) {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
}

const MB = (n: number | null) => (n === null ? "—" : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function SyncCenter() {
  const { devices, pending, service, listening, listenError, peers, refresh, setListening } = useSyncCenter();
  const [self, setSelf] = useState<DeviceRef | null>(null);
  const [storage, setStorage] = useState<{ persisted: boolean | null; usage: number | null; quota: number | null } | null>(null);
  const [log, setLog] = useState<SyncLogEntry[]>([]);
  const [points, setPoints] = useState<RestorePoint[]>([]);
  const [step, setStep] = useState<string | null>(null);
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

  const networkDevices = devices.filter((d) => d.secret && d.relayUrl);
  const lastOk = log.find((l) => l.status === "ok");

  async function syncNow(peer: PairedDevice) {
    setBusy(true);
    try {
      const session = await startNetworkSync(peer, setStep);
      setReview({ kind: "network", session });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 8000 });
      void reload();
    } finally {
      setStep(null);
      setBusy(false);
    }
  }

  async function confirmReview(res: Record<string, Resolution>) {
    if (!review) return;
    setBusy(true);
    try {
      if (review.kind === "network") {
        const { summary, warnings } = await review.session.finish(res);
        setResult({ summary, warnings, peer: review.session.peer.name });
      } else {
        const { answer, warnings } = await commitPlan(review.plan, res, "archivo");
        const file = await sealFile(answer, review.password);
        await saveFile(`respuesta-para-${slug(review.plan.offer.from.name)}-${stampForFile()}.gtsync`, JSON.stringify(file));
        setResult({
          summary: answer.summary,
          warnings,
          peer: review.plan.offer.from.name,
          followUp: `Para terminar, importa el archivo de respuesta en «${review.plan.offer.from.name}» (Sincronización → Importar archivo) con la misma contraseña.`,
        });
      }
      setReview(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 8000 });
    } finally {
      setBusy(false);
      setStep(null);
      void reload();
    }
  }

  function cancelReview() {
    if (review?.kind === "network") review.session.cancel();
    setReview(null);
  }

  return (
    <>
      <PageHeader title="Sincronización" description="Tus datos viven en este dispositivo. Sincroniza con tu otro dispositivo solo cuando tú quieras." />

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

        {/* Sincronizar ahora */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi size={16} /> Sincronizar por Wi‑Fi
            </CardTitle>
            <CardDescription>Con el PC encendido, el servicio local arrancado y en la misma red.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {networkDevices.length === 0 ? (
              <p className="text-sm text-subtle">Aún no has emparejado ningún dispositivo por red. Hazlo en «Emparejar» (abajo).</p>
            ) : (
              networkDevices.map((d) => (
                <div key={d.deviceId} className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    {/iphone|móvil|ipad/i.test(d.name) ? <Smartphone size={18} /> : <Laptop size={18} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{d.name}</div>
                    <div className="text-xs text-subtle truncate">Última: {when(d.lastSyncAt)}</div>
                  </div>
                  <Button onClick={() => syncNow(d)} loading={busy && !review} disabled={busy} className="h-11">
                    <RefreshCw size={15} /> Sincronizar ahora
                  </Button>
                </div>
              ))
            )}
            {step && (
              <p className="text-sm text-subtle flex items-center gap-2" aria-live="polite">
                <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" /> {step}
              </p>
            )}
          </CardContent>
        </Card>

        <FileSync devices={devices} onPlan={(plan, password) => setReview({ kind: "file", plan, password })} onDone={reload} onResult={setResult} />

        <Pairing service={service} listening={listening} listenError={listenError} peers={peers} onToggle={setListening} onPaired={reload} />

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
                        {l.peerName} · {l.method === "red" ? "Wi‑Fi" : "archivo"}
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
            plan={review.kind === "network" ? review.session.plan : review.plan}
            peerName={review.kind === "network" ? review.session.peer.name : review.plan.offer.from.name}
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
      await saveFile(`sincronizacion-para-${slug(name)}-${stampForFile()}.gtsync`, JSON.stringify(file));
      toast.success(`Paquete creado (${offer.entries.length} elemento(s)). Impórtalo en el otro dispositivo.`, { duration: 6000 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function importPicked(file: File) {
    setBusy(true);
    try {
      const text = await readPickedFile(file);
      const { kind, payload } = await openFile(text, importPw);
      if (kind === "offer") {
        const plan = await planIncoming(payload);
        onPlan(plan, importPw);
      } else if (kind === "answer") {
        const summary = await receiveAnswer(payload, "archivo");
        onResult({ summary, warnings: [], peer: (payload as { from: DeviceRef }).from.name });
        onDone();
      } else {
        toast("Es una copia de seguridad: restáurala en «Copias de seguridad».");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileLock2 size={16} /> Sincronizar con archivo cifrado
        </CardTitle>
        <CardDescription>
          Sin red: exporta un paquete aquí, ábrelo en el otro dispositivo (AirDrop, iCloud Drive, correo, USB…) y devuelve el archivo de respuesta.
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
          <Field label="Contraseña del archivo">
            <Input type="password" autoComplete="current-password" value={importPw} onChange={(e) => setImportPw(e.target.value)} />
          </Field>
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={!importPw || busy} className="w-full sm:w-auto h-11">
            <Download size={15} /> Elegir archivo…
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".gtsync,.json,application/json"
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

/* ------------------------------------------------------------ emparejar */

function Pairing({
  service,
  listening,
  listenError,
  peers,
  onToggle,
  onPaired,
}: {
  service: ReturnType<typeof useSyncCenter.getState>["service"];
  listening: boolean;
  listenError: string | null;
  peers: { deviceId: string; name: string }[];
  onToggle: (on: boolean) => Promise<void>;
  onPaired: () => void;
}) {
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  if (service) {
    // Esta app la sirve el servicio local del PC: vista de "PC".
    const qr = `/qr.png?text=${encodeURIComponent(service.setupUrl)}`;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 size={16} /> Emparejar y recibir (PC)
          </CardTitle>
          <CardDescription>Mientras esta pantalla esté abierta y «Recibir» activado, tus dispositivos emparejados pueden sincronizar con este PC.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <label className="flex items-center justify-between gap-3 min-h-[44px]">
            <span>
              <span className="font-medium">Recibir sincronizaciones</span>
              <span className="block text-xs text-subtle">
                {listening ? `Escuchando · ${peers.length} dispositivo(s) conectados ahora` : listenError ?? "Desactivado"}
              </span>
            </span>
            <input type="checkbox" className="h-6 w-6 accent-primary" checked={listening} onChange={(e) => void onToggle(e.target.checked)} />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-[auto,1fr] gap-4 items-start">
            <img src={qr} alt="Código QR de la página de configuración del iPhone" width={160} height={160} className="rounded-lg bg-white p-2" />
            <ol className="list-decimal pl-5 space-y-2">
              <li>
                En el iPhone, escanea el QR (o abre <code className="gt-mono break-all">{service.setupUrl}</code>) e instala el certificado del PC (una sola vez).
              </li>
              <li>
                Comprueba que su huella coincide: <code className="gt-mono text-[11px] break-all">{service.caFingerprint}</code>
              </li>
              <li>
                En la app del iPhone: Sincronización → Emparejar, con la dirección{" "}
                <code className="gt-mono break-all">{service.lanUrls[0]}</code> y este código:
              </li>
            </ol>
          </div>
          <div className="text-center gt-mono text-3xl tracking-widest font-semibold py-2" aria-label={`Código de emparejamiento ${service.code}`}>
            {service.code}
          </div>
          <p className="text-xs text-subtle flex items-start gap-2">
            <ShieldCheck size={14} className="shrink-0 mt-0.5" /> Solo quien vea esta pantalla conoce el código. Cada dispositivo emparejado recibe su propia clave; puedes revocarlo en «Dispositivos».
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 size={16} /> Emparejar con el PC
        </CardTitle>
        <CardDescription>En el PC ejecuta «npm run sync», abre http://localhost:4181 → Sincronización y verás la dirección y el código.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const d = await pairWith(url.trim(), code);
              toast.success(`Emparejado con «${d.name}»`);
              setCode("");
              onPaired();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : String(err), { duration: 9000 });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Dirección del PC" hint="La que muestra el PC, p. ej. https://192.168.1.50:4180">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://192.168.1.50:4180" required />
          </Field>
          <Field label="Código de emparejamiento">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoCorrect="off" placeholder="XXXX-XXXX" className="gt-mono tracking-widest" required />
          </Field>
          <Button type="submit" loading={busy} className="w-full h-11">
            <KeyRound size={15} /> Emparejar
          </Button>
          <p className="text-xs text-subtle">
            Si no conecta, en el iPhone abre primero la página de configuración del PC (QR en la pantalla del PC) e instala su certificado. Siempre puedes sincronizar con archivos.
          </p>
        </form>
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
          <ShieldCheck size={16} /> Dispositivos autorizados
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
                    {d.secret ? "Wi‑Fi y archivos" : "Solo archivos"} · emparejado {when(d.pairedAt)} · última {when(d.lastSyncAt)}
                  </div>
                </div>
                <button
                  className="p-2.5 rounded-md text-subtle hover:text-danger hover:bg-muted"
                  aria-label={`Revocar ${d.name}`}
                  onClick={async () => {
                    if (!confirm(`¿Revocar «${d.name}»? No podrá sincronizar por red con este dispositivo hasta volver a emparejarlo. Los datos no se borran.`)) return;
                    await removeDevice(d.deviceId);
                    toast.success("Dispositivo revocado");
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
          <p className="text-subtle">Empareja o sincroniza con un dispositivo para ver qué falta por enviarle.</p>
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
  const [plain, setPlain] = useState(false);
  const [restorePw, setRestorePw] = useState("");
  const [pendingRestore, setPendingRestore] = useState<BackupFile | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function exportNow() {
    if (!plain && pw.length < 8) return toast.error("Contraseña de al menos 8 caracteres, o marca «sin cifrar»");
    const data = await sealBackup(plain ? null : pw);
    await saveFile(`copia-productividad-${stampForFile()}.${plain ? "json" : "gtbackup"}`, JSON.stringify(data));
    toast.success("Copia exportada");
  }

  async function pick(file: File) {
    try {
      const { kind, payload } = await openFile(await readPickedFile(file), restorePw);
      if (kind !== "backup") return toast.error("Ese archivo es de sincronización, no una copia de seguridad.");
      setPendingRestore(payload as BackupFile);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  const info = pendingRestore ? describeBackup(pendingRestore) : null;

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArchiveRestore size={16} /> Copias de seguridad
        </CardTitle>
        <CardDescription>El navegador podría borrar datos en casos extremos: guarda una copia fuera del dispositivo de vez en cuando.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-2">
          <p className="text-sm font-medium">Exportar copia completa</p>
          <Field label="Contraseña" hint="Contiene tus datos financieros: se recomienda cifrarla.">
            <Input type="password" autoComplete="new-password" value={pw} disabled={plain} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-xs text-subtle min-h-[36px]">
            <input type="checkbox" className="accent-primary h-4 w-4" checked={plain} onChange={(e) => setPlain(e.target.checked)} />
            Exportar sin cifrar (cualquiera con el archivo podrá leerlo)
          </label>
          <Button onClick={exportNow} className="w-full h-11">
            <Download size={15} /> Exportar copia
          </Button>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Restaurar una copia</p>
          <Field label="Contraseña de la copia">
            <Input type="password" autoComplete="current-password" value={restorePw} onChange={(e) => setRestorePw(e.target.value)} />
          </Field>
          <Button variant="outline" className="w-full h-11" onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> Elegir copia…
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".gtbackup,.json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void pick(f);
            }}
          />
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

      <Dialog open={!!pendingRestore} onClose={() => setPendingRestore(null)} title="¿Restaurar esta copia?" description="Reemplazará TODOS los datos actuales de este dispositivo.">
        {info && (
          <div className="space-y-3 text-sm">
            <p>
              Copia de <strong>{info.device}</strong> del {when(info.exportedAt)}.
            </p>
            <ul className="grid grid-cols-2 gap-1 text-xs">
              {Object.entries(info.counts).map(([k, v]) => (
                <li key={k}>
                  {v} {k}
                </li>
              ))}
            </ul>
            <p className="text-xs text-subtle">Antes se guarda un punto de restauración con los datos actuales, así que puedes deshacerlo. Tu PIN y tu tema se conservan.</p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-11" onClick={() => setPendingRestore(null)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                className="flex-1 h-11"
                onClick={async () => {
                  await restoreBackup(pendingRestore!);
                  setPendingRestore(null);
                  toast.success("Copia restaurada");
                  onChanged();
                }}
              >
                Restaurar
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Card>
  );
}

