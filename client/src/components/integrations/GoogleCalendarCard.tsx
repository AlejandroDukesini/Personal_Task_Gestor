import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CalendarCheck2, Link2Off, RefreshCw, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Field, Input, Select } from "@/components/ui/Input";
import { useResource } from "@/hooks/useResource";
import { api } from "@/services/api";
import { describeSchedule } from "@/services/habits/schedule";
import type { GcalLinkRow } from "@/services/localDb";
import { CLIENT_ID_RE, effectiveClientId, loadPrefs, onPrefsChange, savePrefs, type GcalMode, type GcalPrefs } from "@/services/gcal/prefs";
import { chooseCalendar, connect, disconnect, listCalendars, resolve, sessionActive, summarize, syncNow } from "@/services/gcal/service";
import type { CalendarListItem } from "@/services/gcal/client";
import type { Habit } from "@/types";
import { cn } from "@/lib/utils";

const ATTENTION: GcalLinkRow["state"][] = ["conflict", "remote_changed", "remote_deleted", "error"];

export function GoogleCalendarCard() {
  const [prefs, setPrefs] = useState<GcalPrefs>(loadPrefs);
  const [mode, setMode] = useState<GcalMode>(prefs.mode);
  const [busy, setBusy] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<CalendarListItem[] | null>(null);
  const [clientIdDraft, setClientIdDraft] = useState(prefs.clientId);
  const [, tick] = useState(0);
  const links = useResource(() => api.get<GcalLinkRow[]>("/gcal/links"));
  const habits = useResource(() => api.get<Habit[]>("/habits?includeArchived=true"));

  useEffect(() => onPrefsChange(setPrefs), []);
  // La sesión caduca sola (~1 h): se revisa cada 30 s.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const clientId = effectiveClientId(prefs);
  const active = sessionActive();

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
    } catch (e: any) {
      toast.error(e?.message ?? "Error con Google Calendar");
    } finally {
      setBusy(null);
      links.reload();
      habits.reload();
    }
  }

  const doSync = () =>
    run("sync", async () => {
      const r = await syncNow(true);
      if (r.errors.length) toast.error(`${summarize(r)} Con ${r.errors.length} error(es): revisa la lista.`);
      else toast.success(summarize(r));
    });

  const attention = (links.data ?? []).filter((l) => ATTENTION.includes(l.state));
  const habitOf = (id: string) => habits.data?.find((h) => h.id === id);
  const scheduleOf = (l: GcalLinkRow) => habitOf(l.habitId)?.schedules.find((s) => s.id === l.scheduleId);

  return (
    <Card className="lg:col-span-2" id="integraciones">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <CalendarCheck2 size={16} /> Integraciones · Google Calendar
          {prefs.connected ? (
            active ? <Badge color="#16a34a">Conectado</Badge> : <Badge color="#d97706">Sesión caducada</Badge>
          ) : (
            <Badge>No conectado</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-subtle">
          Opcional. Envía los <strong>horarios</strong> de tus hábitos a Google Calendar como eventos (los recurrentes con una sola regla de
          repetición). Nada de lo que pase en Google marca un hábito como realizado: eso solo lo registras tú en la app.
        </p>
        <div className="flex gap-2 text-xs text-subtle">
          <ShieldCheck size={16} className="shrink-0 text-success" />
          <p>
            Solo se piden permisos de calendario (nunca correo ni contactos). El acceso temporal de Google se guarda solo en memoria y caduca en
            ~1 hora; al desconectar se revoca. La app solo modifica eventos que ella misma creó.
          </p>
        </div>

        {!clientId && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2">
            <p className="text-sm flex items-center gap-2">
              <AlertTriangle size={15} className="text-warning" /> Falta configurar el Client ID de OAuth de Google.
            </p>
            <p className="text-xs text-subtle">
              Crea un ID de cliente «Aplicación web» en Google Cloud Console (API de Google Calendar habilitada) con este origen autorizado:{" "}
              <code>{typeof window !== "undefined" ? window.location.origin : ""}</code>. También puede definirse al compilar con{" "}
              <code>VITE_GOOGLE_CLIENT_ID</code>.
            </p>
            <div className="flex gap-2">
              <Input placeholder="123456789-abc.apps.googleusercontent.com" value={clientIdDraft} onChange={(e) => setClientIdDraft(e.target.value.trim())} aria-label="Client ID de Google" />
              <Button
                variant="outline"
                onClick={() => {
                  if (!CLIENT_ID_RE.test(clientIdDraft)) {
                    toast.error("El Client ID no tiene el formato esperado (…apps.googleusercontent.com)");
                    return;
                  }
                  savePrefs({ clientId: clientIdDraft });
                  toast.success("Client ID guardado en este dispositivo");
                }}
              >
                Guardar
              </Button>
            </div>
          </div>
        )}

        {!prefs.connected ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Calendario de destino">
              {(
                [
                  ["dedicated", "Calendario «Hábitos» (recomendado)", "La app crea su propio calendario. Permiso mínimo: solo ve y edita ese calendario."],
                  ["existing", "Uno de mis calendarios", "Eliges el calendario de destino. Permiso: eventos de tus calendarios y su lista."],
                ] as const
              ).map(([k, title, desc]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={mode === k}
                  onClick={() => setMode(k)}
                  className={cn("text-left rounded-lg border p-3 space-y-1", mode === k ? "border-primary ring-1 ring-primary" : "border-border hover:bg-muted")}
                >
                  <span className="text-sm font-medium block">{title}</span>
                  <span className="text-xs text-subtle block">{desc}</span>
                </button>
              ))}
            </div>
            <Button disabled={!clientId} loading={busy === "connect"} onClick={() => run("connect", async () => {
              await connect(mode);
              toast.success("Google Calendar conectado");
              if (mode === "dedicated" && loadPrefs().autoSync) await syncNow(false).then((r) => toast.success(summarize(r)));
            })}>
              <CalendarCheck2 size={15} /> Conectar Google Calendar
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Calendario de destino">
                {prefs.mode === "dedicated" ? (
                  <Input readOnly value={prefs.calendarName ?? "Hábitos"} />
                ) : (
                  <div className="flex gap-2">
                    <Select
                      value={prefs.calendarId ?? ""}
                      onChange={(e) => {
                        const c = calendars?.find((x) => x.id === e.target.value);
                        if (c) chooseCalendar(c);
                      }}
                    >
                      <option value="" disabled>
                        {calendars ? "Elige un calendario…" : prefs.calendarName ?? "Carga tus calendarios"}
                      </option>
                      {prefs.calendarId && !calendars && <option value={prefs.calendarId}>{prefs.calendarName}</option>}
                      {(calendars ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.summary}
                          {c.primary ? " (principal)" : ""}
                        </option>
                      ))}
                    </Select>
                    <Button variant="outline" loading={busy === "cals"} onClick={() => run("cals", async () => {
                      if (!sessionActive()) await connect("existing");
                      setCalendars(await listCalendars());
                    })}>
                      Cargar
                    </Button>
                  </div>
                )}
              </Field>
              <Field label="Qué hábitos sincronizar">
                <Select value={prefs.scope} onChange={(e) => savePrefs({ scope: e.target.value as GcalPrefs["scope"] })}>
                  <option value="all">Todos los hábitos programados</option>
                  <option value="selected">Solo los marcados en cada hábito</option>
                </Select>
              </Field>
              <Field label="Cambios de horario hechos en Google">
                <Select value={prefs.remoteChanges} onChange={(e) => savePrefs({ remoteChanges: e.target.value as GcalPrefs["remoteChanges"] })}>
                  <option value="ask">Preguntarme antes de aplicarlos</option>
                  <option value="apply">Aplicarlos a la programación automáticamente</option>
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm self-end h-9">
                <input type="checkbox" checked={prefs.autoSync} onChange={(e) => savePrefs({ autoSync: e.target.checked })} />
                Sincronizar automáticamente al hacer cambios
              </label>
            </div>

            {!active && (
              <p className="text-sm text-warning">La sesión con Google caducó. Pulsa «Sincronizar ahora» para renovarla (se abrirá la ventana de Google).</p>
            )}

            <div className="flex flex-wrap gap-2 items-center">
              <Button loading={busy === "sync"} onClick={doSync}>
                <RefreshCw size={15} /> Sincronizar ahora
              </Button>
              <Button
                variant="outline"
                loading={busy === "disconnect"}
                onClick={() => {
                  if (!confirm("¿Desconectar Google Calendar en este dispositivo? Tus horarios e historial se conservan; los eventos ya creados en Google no se borran.")) return;
                  run("disconnect", async () => {
                    await disconnect();
                    setCalendars(null);
                    toast.success("Google Calendar desconectado");
                  });
                }}
              >
                <Link2Off size={15} /> Desconectar
              </Button>
              {prefs.lastSyncAt && <span className="text-xs text-subtle">Última sincronización: {new Date(prefs.lastSyncAt).toLocaleString("es-ES")}</span>}
            </div>
          </div>
        )}

        {attention.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle size={15} className="text-warning" /> Requieren tu decisión ({attention.length})
            </h3>
            {attention.map((l) => {
              const h = habitOf(l.habitId);
              const s = scheduleOf(l);
              const r = (l.remote ?? {}) as Record<string, string | null>;
              return (
                <div key={l.id} className="rounded-lg border border-border p-3 text-sm space-y-2">
                  <p className="font-medium">
                    {h?.name ?? "Hábito eliminado"} {s && <span className="text-subtle font-normal">· en la app: {describeSchedule(s)}</span>}
                  </p>
                  {l.state === "remote_deleted" && <p className="text-subtle">Se borró en Google Calendar. En la app sigue programado.</p>}
                  {(l.state === "conflict" || l.state === "remote_changed") && (
                    <p className="text-subtle">
                      {l.state === "conflict" ? "Se cambió en ambos sitios." : "Se cambió en Google Calendar."} En Google: {r.day ?? "?"} {r.start ?? ""}
                      {r.end ? `–${r.end}` : ""} {r.rule ? `(${r.rule})` : ""}
                      {l.lastError && ` · ${l.lastError}`}
                    </p>
                  )}
                  {l.state === "error" && <p className="text-danger">{l.lastError ?? "Error al sincronizar"}</p>}
                  <div className="flex flex-wrap gap-2">
                    {(l.state === "conflict" || l.state === "remote_changed") && (
                      <>
                        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run(l.id, () => resolve(l.id, "local"))}>
                          Mantener el horario de la app
                        </Button>
                        <Button size="sm" variant="outline" disabled={!!busy || l.lastError !== null && l.state === "remote_changed"} onClick={() => run(l.id, () => resolve(l.id, "remote"))}>
                          Usar el horario de Google
                        </Button>
                      </>
                    )}
                    {l.state === "remote_deleted" && (
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run(l.id, () => resolve(l.id, "recreate"))}>
                        Volver a crearlo en Google
                      </Button>
                    )}
                    {l.state === "error" && prefs.connected && (
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={doSync}>
                        Reintentar
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {prefs.activity.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-subtle">Registro de actividad ({prefs.activity.length})</summary>
            <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {prefs.activity.map((a, i) => (
                <li key={i} className={cn("text-xs", a.level === "error" ? "text-danger" : a.level === "warn" ? "text-warning" : "text-subtle")}>
                  {new Date(a.at).toLocaleString("es-ES")} · {a.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
