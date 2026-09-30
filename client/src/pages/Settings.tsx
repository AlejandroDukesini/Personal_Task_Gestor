import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  Bell,
  DatabaseBackup,
  Download,
  ImageUp,
  Lock,
  Palette,
  Shuffle,
  Smartphone,
  Upload,
  UserCircle2,
  Wifi,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { ThemePicker } from "@/components/ThemePicker";
import { GoogleCalendarCard } from "@/components/integrations/GoogleCalendarCard";
import { BackupCard } from "@/components/backup/BackupCard";
import { SUPPORTED_FORMATS_HELP, inspectBackupText } from "@/services/backup/backup";
import { useRestoreWizard } from "@/store/restoreWizard";
import { Link } from "react-router-dom";
import { useConfig } from "@/store/config";
import { useT } from "@/lib/i18n";
import { api } from "@/services/api";
import { CURRENCIES } from "@/lib/money";
import {
  notificationPermission,
  notify,
  requestNotificationPermission,
} from "@/lib/notifications";
import { isIos, isStandalone, onInstallAvailability, promptInstall } from "@/lib/pwa";

const TIMEZONES = [
  "America/Bogota",
  "America/Mexico_City",
  "America/Lima",
  "America/Argentina/Buenos_Aires",
  "America/Santiago",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/Madrid",
  "UTC",
];

/** Desplazamiento suave a una sección (y hash en la URL para poder enlazarla). */
const jump = (id: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  history.replaceState(null, "", `#${id}`);
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
};

export function SettingsPage() {
  const t = useT();
  const cfg = useConfig();
  const openWizard = useRestoreWizard((st) => st.openWizard);
  const [pin, setPin] = useState("");
  const [installAvailable, setInstallAvailable] = useState(false);
  const [permission, setPermission] = useState(notificationPermission());

  useEffect(() => onInstallAvailability(setInstallAvailable), []);

  // La paleta de comandos enlaza a /configuracion#sync: se desplaza al panel.
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (target !== "sync" && target !== "integraciones") return;
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  async function enableNotifications() {
    const granted = await requestNotificationPermission();
    setPermission(notificationPermission());
    if (!granted) {
      toast.error(t("notif.denied"));
      return;
    }
    await cfg.update({ notificationsEnabled: true });
    await notify(t("notif.testTitle"), { body: t("notif.testBody") });
    toast.success(t("notif.enabled"));
  }

  // Formulario de marca (nombre app, logo texto, nombre usuario).
  const isImageLogo = !!cfg.appLogo && cfg.appLogo.startsWith("data:");
  const [name, setName] = useState(cfg.appName);
  const [logoText, setLogoText] = useState(isImageLogo ? "" : cfg.appLogo ?? "");
  const [uname, setUname] = useState(cfg.userName ?? "");

  useEffect(() => {
    if (!cfg.loaded) return;
    setName(cfg.appName);
    setLogoText(cfg.appLogo && cfg.appLogo.startsWith("data:") ? "" : cfg.appLogo ?? "");
    setUname(cfg.userName ?? "");
  }, [cfg.loaded]);

  async function saveBrand() {
    await cfg.update({
      appName: name.trim() || "Productividad",
      appLogo: logoText.trim() ? logoText.trim() : isImageLogo ? cfg.appLogo : null,
      userName: uname.trim() || null,
    });
    toast.success(t("toast.saved"));
  }

  async function uploadLogo(file: File) {
    try {
      const dataUrl = await resizeImage(file, 128);
      await cfg.update({ appLogo: dataUrl });
      setLogoText("");
      toast.success(t("toast.saved"));
    } catch {
      toast.error("Error");
    }
  }

  async function removeLogoImage() {
    await cfg.update({ appLogo: null });
    setLogoText("");
    toast.success(t("toast.saved"));
  }

  function generatePin() {
    // Math.random() no es criptográficamente seguro: su estado interno es
    // predecible a partir de salidas previas, así que un PIN generado con él
    // es adivinable. crypto.getRandomValues sí usa el CSPRNG del navegador.
    // Muestreo por rechazo para que los 9000 valores sean equiprobables
    // (un simple % 9000 sesgaría los primeros valores del rango).
    const buf = new Uint32Array(1);
    let n: number;
    const limit = Math.floor(0xffffffff / 9000) * 9000;
    do {
      crypto.getRandomValues(buf);
      n = buf[0];
    } while (n >= limit);
    const p = String(1000 + (n % 9000));
    setPin(p);
    toast.success(t("toast.pinGenerated", { pin: p }));
  }

  async function setPinHandler() {
    if (pin.length < 4) {
      toast.error(t("toast.pinMin"));
      return;
    }
    await api.post("/settings/pin", { pin });
    setPin("");
    await cfg.load();
    toast.success(t("toast.pinSaved"));
  }

  async function removePin() {
    await api.delete("/settings/pin");
    await cfg.load();
    toast.success(t("toast.pinRemoved"));
  }

  async function exportData(format: "json" | "csv") {
    const blob = await api.get<any>("/backup/export");
    if (format === "json") {
      downloadFile(`backup-${Date.now()}.json`, JSON.stringify(blob, null, 2), "application/json");
    } else {
      const csvParts: string[] = [];
      for (const [k, v] of Object.entries(blob.data ?? {})) {
        if (Array.isArray(v) && v.length) {
          const keys = Object.keys(v[0]);
          csvParts.push(`### ${k}\n${keys.join(",")}\n` + v.map((row: any) => keys.map((kk) => JSON.stringify(row[kk] ?? "")).join(",")).join("\n"));
        }
      }
      downloadFile(`backup-${Date.now()}.csv`, csvParts.join("\n\n"), "text/csv");
    }
    toast.success(t("toast.exported"));
  }

  /**
   * Cualquier copia (nueva o antigua, cifrada o no) se restaura con el mismo
   * asistente guiado: detecta el cifrado, valida, muestra una vista previa y
   * guarda antes una copia de los datos actuales. Antes aquí solo se aceptaba
   * la exportación antigua y el resto se rechazaba con un mensaje confuso.
   */
  async function importFile(file: File) {
    const kind = inspectBackupText(await file.text().catch(() => ""));
    if (kind.status === "backup") {
      openWizard({ file, origin: "detected" });
      return;
    }
    toast.error(
      kind.status === "sync-package"
        ? "Es un paquete de sincronización: ábrelo en Sincronización › Sincronizar con archivo cifrado."
        : `${kind.reason} ${SUPPORTED_FORMATS_HELP}`,
      { duration: 8000 }
    );
  }

  const previewIsImage = logoText.trim() === "" && isImageLogo;

  return (
    <>
      <PageHeader title={t("settings.title")} description={t("settings.subtitle")} />

      {/* Accesos directos a las secciones más buscadas. */}
      <nav aria-label="Secciones de configuración" className="mb-4 flex flex-wrap gap-2">
        <a href="#copias" onClick={jump("copias")} className="gt-pill inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-fg">
          <DatabaseBackup size={14} /> Copias de seguridad y restauración
        </a>
        <a href="#integraciones" onClick={jump("integraciones")} className="gt-pill inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-muted">
          Integraciones
        </a>
        <a href="#sync" onClick={jump("sync")} className="gt-pill inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-muted">
          Sincronización
        </a>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Perfil y marca */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCircle2 size={16} /> {t("brand.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-subtle">{t("brand.help")}</p>

            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-primary text-primary-fg flex items-center justify-center text-lg font-bold overflow-hidden shrink-0">
                {previewIsImage ? (
                  <img src={cfg.appLogo!} alt="logo" className="h-full w-full object-cover" />
                ) : (
                  logoText.trim() || (name.trim()[0] ?? "P").toUpperCase()
                )}
              </div>
              <div className="text-sm">
                <div className="font-semibold">{name.trim() || "Productividad"}</div>
                <div className="text-subtle text-xs">{t("brand.title")}</div>
              </div>
            </div>

            <Field label={t("brand.appName")}>
              <Input
                value={name}
                maxLength={40}
                placeholder={t("brand.appNamePlaceholder")}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field label={t("brand.logo")}>
              <div className="flex gap-2">
                <Input
                  value={logoText}
                  maxLength={2}
                  placeholder={t("brand.logoPlaceholder")}
                  onChange={(e) => setLogoText(e.target.value)}
                  className="w-20 text-center"
                />
                <label className="inline-flex items-center gap-2 border border-border bg-transparent hover:bg-muted text-text rounded-lg h-9 px-4 text-sm font-medium cursor-pointer">
                  <ImageUp size={14} /> {t("brand.logoImage")}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
                  />
                </label>
                {isImageLogo && (
                  <Button variant="outline" onClick={removeLogoImage}>
                    {t("brand.logoReset")}
                  </Button>
                )}
              </div>
            </Field>

            <Field label={t("brand.userName")}>
              <Input
                value={uname}
                maxLength={40}
                placeholder={t("brand.userNamePlaceholder")}
                onChange={(e) => setUname(e.target.value)}
              />
            </Field>

            <Button onClick={saveBrand}>{t("brand.save")}</Button>
          </CardContent>
        </Card>

        {/* Apariencia: selector de skin, modo, acento y escala tipográfica. */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette size={16} /> {t("settings.appearance")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ThemePicker />
          </CardContent>
        </Card>

        {/* Notificaciones */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell size={16} /> {t("notif.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {permission === "unsupported" ? (
              <p className="text-sm text-subtle">{t("notif.unsupported")}</p>
            ) : permission === "granted" && cfg.notificationsEnabled ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-success">{t("notif.active")}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => notify(t("notif.testTitle"), { body: t("notif.testBody") })}
                >
                  {t("notif.test")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => cfg.update({ notificationsEnabled: false })}
                >
                  {t("notif.disable")}
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-subtle">{t("notif.help")}</p>
                <Button onClick={enableNotifications} disabled={permission === "denied"}>
                  <Bell size={14} /> {t("notif.enable")}
                </Button>
                {permission === "denied" && (
                  <p className="text-xs text-warning">{t("notif.blocked")}</p>
                )}
              </>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("notif.habitTime")} hint={t("notif.habitTimeHelp")}>
                <Input
                  type="time"
                  value={cfg.habitReminderTime ?? ""}
                  onChange={(e) =>
                    cfg.update({ habitReminderTime: e.target.value || null })
                  }
                />
              </Field>
              <Field label={t("notif.digestTime")} hint={t("notif.digestTimeHelp")}>
                <Input
                  type="time"
                  value={cfg.dailyDigestTime ?? ""}
                  onChange={(e) => cfg.update({ dailyDigestTime: e.target.value || null })}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* Sincronización local + instalación */}
        <Card className="lg:col-span-2" id="sync">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi size={16} /> {t("sync.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-subtle">
              Tus datos se guardan en este dispositivo. La sincronización con tu otro dispositivo (Wi‑Fi o archivo cifrado), las
              copias de seguridad y los dispositivos autorizados están en su propia sección.
            </p>
            <Link to="/sincronizacion" className="gt-control inline-flex items-center gap-2 h-11 px-4 bg-primary text-primary-fg font-medium">
              <Wifi size={15} /> Abrir Sincronización
            </Link>

            <div className="pt-4 border-t border-t-theme border-border space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Smartphone size={15} /> {t("pwa.title")}
              </div>
              {isStandalone() ? (
                <p className="text-sm text-success">{t("pwa.installed")}</p>
              ) : isIos() ? (
                // iOS no ofrece instalación automática: solo desde Safari, a mano.
                <ol className="text-sm list-decimal pl-5 space-y-1.5">
                  <li>Abre esta página en <strong>Safari</strong> (no en otro navegador).</li>
                  <li>
                    Pulsa <strong>Compartir</strong> (el cuadrado con la flecha hacia arriba).
                  </li>
                  <li>
                    Elige <strong>«Añadir a pantalla de inicio»</strong> y confirma.
                  </li>
                  <li className="text-subtle">
                    Abre la app desde su icono: funciona sin conexión y sus datos quedan protegidos. Importante: la app instalada y
                    Safari guardan datos por separado.
                  </li>
                </ol>
              ) : (
                <>
                  <p className="text-sm text-subtle">{t("pwa.help")}</p>
                  <Button
                    variant="outline"
                    disabled={!installAvailable}
                    onClick={async () => {
                      if (!(await promptInstall())) toast(t("pwa.unavailable"));
                    }}
                  >
                    <Smartphone size={14} /> {t("pwa.install")}
                  </Button>
                  {!installAvailable && (
                    <p className="text-xs text-subtle">{t("pwa.manual")}</p>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Copias de seguridad y recuperación */}
        <BackupCard />

        {/* Integraciones */}
        <GoogleCalendarCard />

        {/* Idioma y formato */}
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.langFormat")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label={t("settings.language")}>
              <Select
                value={cfg.language}
                onChange={(e) => cfg.update({ language: e.target.value })}
              >
                <option value="es">Español</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Field label={t("settings.timezone")}>
              <Select
                value={cfg.timezone}
                onChange={(e) => cfg.update({ timezone: e.target.value })}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Moneda por defecto (finanzas)" hint="Se propone al crear cuentas, presupuestos y metas.">
              <Select value={cfg.currency} onChange={(e) => cfg.update({ currency: e.target.value })}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("settings.dateFormat")}>
              <Select
                value={cfg.dateFormat}
                onChange={(e) => cfg.update({ dateFormat: e.target.value })}
              >
                <option value="dd/MM/yyyy">DD/MM/AAAA</option>
                <option value="MM/dd/yyyy">MM/DD/AAAA</option>
                <option value="yyyy-MM-dd">AAAA-MM-DD</option>
              </Select>
            </Field>
          </CardContent>
        </Card>

        {/* Seguridad */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock size={16} /> {t("settings.security")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-subtle">{t("settings.pinHelp")}</p>
            {cfg.pinSet ? (
              <Button variant="outline" onClick={removePin}>
                {t("settings.removePin")}
              </Button>
            ) : (
              <div className="flex gap-2 flex-wrap">
                <Input
                  type="password"
                  inputMode="numeric"
                  placeholder={t("settings.newPin")}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="flex-1 min-w-[10rem]"
                />
                <Button variant="outline" onClick={generatePin}>
                  <Shuffle size={14} /> {t("settings.generatePin")}
                </Button>
                <Button onClick={setPinHandler}>{t("settings.savePin")}</Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Backup */}
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.data")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-subtle">{t("settings.dataHelp")}</p>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={() => exportData("json")}>
                <Download size={14} /> {t("settings.exportJson")}
              </Button>
              <Button variant="outline" onClick={() => exportData("csv")}>
                <Download size={14} /> {t("settings.exportCsv")}
              </Button>
              <label className="inline-flex items-center gap-2 border border-border bg-transparent hover:bg-muted text-text rounded-lg h-9 px-4 text-sm font-medium cursor-pointer">
                <Upload size={14} /> {t("settings.importJson")}
                <input
                  type="file"
                  accept=".json,.gtbackup,application/json"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
                />
              </label>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// Redimensiona una imagen a un cuadrado max×max y devuelve un data URL liviano.
function resizeImage(file: File, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = Math.min(max, Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no ctx"));
        const scale = size / Math.max(img.width, img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
