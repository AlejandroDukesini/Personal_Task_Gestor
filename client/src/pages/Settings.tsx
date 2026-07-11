import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  Download,
  ImageUp,
  Lock,
  Monitor,
  Moon,
  Palette,
  Shuffle,
  Sun,
  Type,
  Upload,
  UserCircle2,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { useTheme } from "@/store/theme";
import { useConfig } from "@/store/config";
import { useT } from "@/lib/i18n";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";

const COLORS = ["#6366f1", "#10b981", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

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

export function SettingsPage() {
  const t = useT();
  const { theme, setTheme, primaryColor, setPrimaryColor, fontScale, setFontScale } = useTheme();
  const cfg = useConfig();
  const [pin, setPin] = useState("");

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
    const p = String(Math.floor(1000 + Math.random() * 9000));
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

  async function importFile(file: File) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!confirm("¿Importar este archivo? Los datos existentes con el mismo ID se reemplazarán.")) return;
    await api.post("/backup/import", { ...data, replace: false });
    toast.success(t("toast.imported"));
  }

  const previewIsImage = logoText.trim() === "" && isImageLogo;

  return (
    <>
      <PageHeader title={t("settings.title")} description={t("settings.subtitle")} />

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

        {/* Tema */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette size={16} /> {t("settings.appearance")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label={t("settings.theme")}>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "light", label: t("settings.themeLight"), Icon: Sun },
                  { id: "dark", label: t("settings.themeDark"), Icon: Moon },
                  { id: "system", label: t("settings.themeSystem"), Icon: Monitor },
                ].map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    onClick={() => setTheme(id as any)}
                    className={cn(
                      "flex flex-col items-center gap-1 p-3 rounded-lg border text-sm",
                      theme === id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted"
                    )}
                  >
                    <Icon size={18} />
                    {label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={t("settings.primaryColor")}>
              <div className="flex gap-2 flex-wrap">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setPrimaryColor(c)}
                    className="h-9 w-9 rounded-full border-2 transition-transform"
                    style={{
                      background: c,
                      borderColor: primaryColor === c ? "rgb(var(--text))" : "transparent",
                      transform: primaryColor === c ? "scale(1.1)" : "scale(1)",
                    }}
                  />
                ))}
              </div>
            </Field>

            <Field label={t("settings.fontSize", { value: Math.round(fontScale * 100) })}>
              <div className="flex items-center gap-3">
                <Type size={14} className="text-subtle" />
                <input
                  type="range"
                  min={0.85}
                  max={1.3}
                  step={0.05}
                  value={fontScale}
                  onChange={(e) => setFontScale(Number(e.target.value))}
                  className="flex-1 accent-primary"
                />
                <Type size={18} className="text-subtle" />
              </div>
            </Field>
          </CardContent>
        </Card>

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
                  accept=".json"
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
