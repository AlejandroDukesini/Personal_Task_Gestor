import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Download, Lock, Monitor, Moon, Palette, Sun, Type, Upload } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { useTheme } from "@/store/theme";
import { api } from "@/services/api";
import type { Settings } from "@/types";
import { cn } from "@/lib/utils";

const COLORS = ["#6366f1", "#10b981", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export function SettingsPage() {
  const { theme, setTheme, primaryColor, setPrimaryColor, fontScale, setFontScale } = useTheme();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pin, setPin] = useState("");

  useEffect(() => {
    api.get<Settings>("/settings").then(setSettings);
  }, []);

  async function syncRemote(patch: Partial<Settings>) {
    const updated = await api.put<Settings>("/settings", patch);
    setSettings(updated);
  }

  async function setPinHandler() {
    if (pin.length < 4) {
      toast.error("Mínimo 4 dígitos");
      return;
    }
    await api.post("/settings/pin", { pin });
    setPin("");
    setSettings((s) => (s ? { ...s, pinSet: true, pinEnabled: true } : s));
    toast.success("PIN guardado");
  }

  async function removePin() {
    await api.delete("/settings/pin");
    setSettings((s) => (s ? { ...s, pinSet: false, pinEnabled: false } : s));
    toast.success("PIN eliminado");
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
    toast.success("Exportado");
  }

  async function importFile(file: File) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!confirm("¿Importar este archivo? Los datos existentes con el mismo ID se reemplazarán.")) return;
    await api.post("/backup/import", { ...data, replace: false });
    toast.success("Importado correctamente");
  }

  return (
    <>
      <PageHeader title="Configuración" description="Personaliza la app y gestiona tus datos." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tema */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette size={16} /> Apariencia
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Tema">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "light", label: "Claro", Icon: Sun },
                  { id: "dark", label: "Oscuro", Icon: Moon },
                  { id: "system", label: "Sistema", Icon: Monitor },
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

            <Field label="Color primario">
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

            <Field label={`Tamaño de fuente: ${Math.round(fontScale * 100)}%`}>
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
            <CardTitle>Idioma y formato</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Idioma">
              <Select
                value={settings?.language ?? "es"}
                onChange={(e) => syncRemote({ language: e.target.value })}
              >
                <option value="es">Español</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Field label="Formato de fecha">
              <Select
                value={settings?.dateFormat ?? "dd/MM/yyyy"}
                onChange={(e) => syncRemote({ dateFormat: e.target.value })}
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
              <Lock size={16} /> Seguridad
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-subtle">
              Protege el acceso a tu app con un PIN local. Se guarda como hash en tu base de datos local.
            </p>
            {settings?.pinSet ? (
              <Button variant="outline" onClick={removePin}>
                Eliminar PIN actual
              </Button>
            ) : (
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder="Nuevo PIN (4+ dígitos)"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
                <Button onClick={setPinHandler}>Guardar PIN</Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Backup */}
        <Card>
          <CardHeader>
            <CardTitle>Datos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-subtle">
              Exporta una copia de seguridad o importa datos desde otro backup.
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={() => exportData("json")}>
                <Download size={14} /> Exportar JSON
              </Button>
              <Button variant="outline" onClick={() => exportData("csv")}>
                <Download size={14} /> Exportar CSV
              </Button>
              <label className="inline-flex items-center gap-2 border border-border bg-transparent hover:bg-muted text-text rounded-lg h-9 px-4 text-sm font-medium cursor-pointer">
                <Upload size={14} /> Importar JSON
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
