import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { Archive, ArchiveRestore, Database, Download, FileJson, FileSpreadsheet, Plus, Trash2, Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/services/api";
import { loadDb, type FinCategoryKind } from "@/services/localDb";
import type { FinanceData } from "@/hooks/useFinance";
import { transactionsToCsv, type CsvSummary, type ImportSummary } from "@/services/finance/io";
import { financeSqlDump } from "@/services/finance/sql";
import { formatMoney } from "@/lib/money";
import { DynIcon, KIND_LABEL, errorMessage } from "./shared";

const MAX_FILE = 10 * 1024 * 1024;

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const COLLECTION_LABEL: Record<string, string> = {
  finAccounts: "Cuentas",
  finCategories: "Categorías",
  finTransactions: "Movimientos",
  finBudgets: "Presupuestos",
  finGoals: "Metas",
  finRecurring: "Recurrentes",
};

export function DataView({ data, reload }: { data: FinanceData; reload: () => void }) {
  const jsonRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const [jsonImport, setJsonImport] = useState<{ payload: unknown; mode: "newer" | "merge"; summary: ImportSummary } | null>(null);
  const [csvImport, setCsvImport] = useState<{ text: string; summary: CsvSummary; defaultAccountId: string; createCategories: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const stamp = new Date().toISOString().slice(0, 10);

  async function exportJson() {
    const payload = await api.get("/finance/export");
    download(`finanzas-${stamp}.json`, JSON.stringify(payload, null, 2), "application/json");
    toast.success("Exportado");
  }

  function exportCsv() {
    download(`movimientos-${stamp}.csv`, transactionsToCsv({ finAccounts: data.accounts, finCategories: data.categories, tags: data.tags, finTags: data.finTags }, data.transactions), "text/csv;charset=utf-8");
  }

  function exportSql(includeSchema: boolean) {
    download(`finanzas-${stamp}${includeSchema ? "-completo" : "-datos"}.sql`, financeSqlDump(loadDb(), { includeSchema }), "application/sql");
  }

  async function readFile(file: File): Promise<string | null> {
    if (file.size > MAX_FILE) {
      toast.error("El archivo supera 10 MB");
      return null;
    }
    return file.text();
  }

  async function pickJson(file: File) {
    const text = await readFile(file);
    if (text === null) return;
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      toast.error("El archivo no es un JSON válido");
      return;
    }
    const summary = await api.post<ImportSummary>("/finance/import/preview", { data: payload, mode: "newer" });
    setJsonImport({ payload, mode: "newer", summary });
  }

  async function changeMode(mode: "newer" | "merge") {
    if (!jsonImport) return;
    const summary = await api.post<ImportSummary>("/finance/import/preview", { data: jsonImport.payload, mode });
    setJsonImport({ ...jsonImport, mode, summary });
  }

  async function applyJson() {
    if (!jsonImport) return;
    setBusy(true);
    try {
      await api.post("/finance/import", { data: jsonImport.payload, mode: jsonImport.mode });
      toast.success("Importación aplicada");
      setJsonImport(null);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function previewCsv(text: string, defaultAccountId: string, createCategories: boolean) {
    const summary = await api.post<CsvSummary>("/finance/import/csv/preview", {
      text,
      options: { defaultAccountId: defaultAccountId || null, createCategories },
    });
    setCsvImport({ text, summary, defaultAccountId, createCategories });
  }

  async function applyCsv() {
    if (!csvImport) return;
    setBusy(true);
    try {
      const res = await api.post<CsvSummary>("/finance/import/csv", {
        text: csvImport.text,
        options: { defaultAccountId: csvImport.defaultAccountId || null, createCategories: csvImport.createCategories },
      });
      toast.success(`${res.toImport} movimiento(s) importados`);
      setCsvImport(null);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
            <Download size={16} aria-hidden /> Exportar
          </CardTitle>
          <CardDescription>Copias de tus datos financieros. Contienen información sensible: guárdalas en un lugar seguro.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportJson}>
            <FileJson size={14} /> JSON (reimportable)
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={data.transactions.length === 0}>
            <FileSpreadsheet size={14} /> Movimientos CSV
          </Button>
          <Button variant="outline" onClick={() => exportSql(true)}>
            <Database size={14} /> SQL (esquema + datos)
          </Button>
          <Button variant="ghost" onClick={() => exportSql(false)}>
            SQL solo datos
          </Button>
          <p className="text-xs text-subtle w-full">
            El SQL es compatible con SQLite y usa la migración versionada <span className="gt-mono">V1__finance</span>. Importes en céntimos enteros.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
            <Upload size={16} aria-hidden /> Importar
          </CardTitle>
          <CardDescription>
            Se valida todo antes de aplicar (formato, importes, fechas, referencias y duplicados). Si hay un solo error no se cambia nada. Por seguridad no se ejecuta SQL importado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => jsonRef.current?.click()}>
              <FileJson size={14} /> JSON de finanzas
            </Button>
            <Button variant="outline" onClick={() => csvRef.current?.click()}>
              <FileSpreadsheet size={14} /> CSV de movimientos
            </Button>
          </div>
          <input
            ref={jsonRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) pickJson(f).catch((err) => toast.error(errorMessage(err)));
            }}
          />
          <input
            ref={csvRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const text = await readFile(f);
              if (text !== null) previewCsv(text, "", false).catch((err) => toast.error(errorMessage(err)));
            }}
          />
          <p className="text-xs text-subtle">
            CSV: columnas <span className="gt-mono">fecha, importe, concepto</span> obligatorias; opcionales{" "}
            <span className="gt-mono">tipo, cuenta, cuenta_destino, categoria, descripcion, etiquetas (a|b), motivo, id</span>. Separador «,» o «;».
            Fechas AAAA-MM-DD o DD/MM/AAAA. Sin columna tipo, el signo del importe decide ingreso/gasto.
          </p>

          {jsonImport && (
            <div className="gt-surface p-3 space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <strong>Vista previa (JSON)</strong>
                <Badge color={jsonImport.summary.valid ? "#16a34a" : "#dc2626"}>{jsonImport.summary.valid ? "Válido" : "Con errores"}</Badge>
                <Select aria-label="Modo" value={jsonImport.mode} onChange={(e) => changeMode(e.target.value as any)} className="w-auto ml-auto">
                  <option value="newer">Conservar lo más reciente</option>
                  <option value="merge">Lo importado sobrescribe</option>
                </Select>
              </div>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {Object.entries(jsonImport.summary.counts).map(([c, n]) => (
                  <li key={c}>
                    <span className="font-medium">{COLLECTION_LABEL[c] ?? c}</span>: +{n.insert} nuevas · {n.update} actualizadas · {n.unchanged} iguales
                    {n.skipped ? ` · ${n.skipped} omitidas` : ""}
                  </li>
                ))}
              </ul>
              {jsonImport.summary.warnings.map((w) => (
                <p key={w} className="text-xs text-warning">{w}</p>
              ))}
              {jsonImport.summary.errors.slice(0, 10).map((er, i) => (
                <p key={i} className="text-xs text-danger">
                  {COLLECTION_LABEL[er.collection] ?? er.collection}
                  {er.index >= 0 ? ` #${er.index + 1}` : ""}: {er.message}
                </p>
              ))}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setJsonImport(null)}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={applyJson} disabled={!jsonImport.summary.valid} loading={busy}>
                  Aplicar importación
                </Button>
              </div>
            </div>
          )}

          {csvImport && (
            <div className="gt-surface p-3 space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <strong>Vista previa (CSV)</strong>
                <Badge color={csvImport.summary.valid ? "#16a34a" : "#dc2626"}>{csvImport.summary.valid ? "Válido" : "Con errores"}</Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="Cuenta si falta la columna">
                  <Select value={csvImport.defaultAccountId} onChange={(e) => previewCsv(csvImport.text, e.target.value, csvImport.createCategories)}>
                    <option value="">—</option>
                    {data.accounts.filter((a) => !a.archived).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <label className="flex items-center gap-2 text-xs self-end pb-2">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={csvImport.createCategories}
                    onChange={(e) => previewCsv(csvImport.text, csvImport.defaultAccountId, e.target.checked)}
                  />
                  Crear categorías que no existan
                </label>
              </div>
              <p className="text-xs">
                {csvImport.summary.total} filas · <strong>{csvImport.summary.toImport}</strong> a importar · {csvImport.summary.duplicates} duplicadas (se omiten)
                {csvImport.summary.newCategories.length ? ` · categorías nuevas: ${csvImport.summary.newCategories.join(", ")}` : ""}
              </p>
              {csvImport.summary.errors.slice(0, 10).map((er) => (
                <p key={er.line} className="text-xs text-danger">
                  Línea {er.line}: {er.message}
                </p>
              ))}
              {csvImport.summary.warnings.slice(0, 5).map((w) => (
                <p key={w} className="text-xs text-warning">{w}</p>
              ))}
              {csvImport.summary.preview.length > 0 && (
                <ul className="text-xs divide-y divide-border max-h-48 overflow-y-auto">
                  {csvImport.summary.preview.map((p) => (
                    <li key={p.line} className={p.duplicate ? "py-1 flex gap-2 text-subtle line-through" : "py-1 flex gap-2"}>
                      <span className="w-20 shrink-0">{p.date}</span>
                      <span className="flex-1 truncate">
                        {KIND_LABEL[p.kind as keyof typeof KIND_LABEL]} · {p.concept} · {p.account}
                      </span>
                      <span className="tabular-nums">{formatMoney(p.amount, data.accounts.find((a) => a.name === p.account)?.currency ?? data.defaultCurrency)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setCsvImport(null)}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={applyCsv} disabled={!csvImport.summary.valid || csvImport.summary.toImport === 0} loading={busy}>
                  Importar {csvImport.summary.toImport}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <CategoriesManager data={data} reload={reload} />
    </div>
  );
}

function CategoriesManager({ data, reload }: { data: FinanceData; reload: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<FinCategoryKind>("expense");
  const [color, setColor] = useState("#64748b");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/finance/categories", { name, kind, color });
      setName("");
      toast.success("Categoría creada");
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function rename(id: string, current: string) {
    const next = prompt("Nuevo nombre", current)?.trim();
    if (!next || next === current) return;
    try {
      await api.put(`/finance/categories/${id}`, { name: next });
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function toggle(id: string, archived: boolean) {
    await api.put(`/finance/categories/${id}`, { archived: !archived });
    reload();
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar la categoría? Solo es posible si no está en uso.")) return;
    try {
      await api.delete(`/finance/categories/${id}`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const label = { income: "Ingreso", expense: "Gasto", both: "Ambos" };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm sm:text-base">Categorías financieras</CardTitle>
        <CardDescription>Las etiquetas se comparten con las tareas y se gestionan en la sección Etiquetas.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={add} className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[10rem]">
            <Field label="Nueva categoría">
              <Input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Select aria-label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as FinCategoryKind)} className="w-auto">
            <option value="expense">Gasto</option>
            <option value="income">Ingreso</option>
            <option value="both">Ambos</option>
          </Select>
          <Input aria-label="Color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-12 h-9 p-1" />
          <Button type="submit">
            <Plus size={14} /> Añadir
          </Button>
        </form>
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {data.categories.map((c) => (
            <li key={c.id} className={c.archived ? "flex items-center gap-2 p-2 rounded-md border border-border opacity-60" : "flex items-center gap-2 p-2 rounded-md border border-border"}>
              <span className="h-7 w-7 rounded-md flex items-center justify-center shrink-0" style={{ background: `${c.color}22`, color: c.color }}>
                <DynIcon name={c.icon} size={14} />
              </span>
              <button className="flex-1 min-w-0 text-left text-sm truncate hover:underline" onClick={() => rename(c.id, c.name)} title="Renombrar">
                {c.name}
              </button>
              <span className="text-[10px] text-subtle">{label[c.kind]}</span>
              <button className="p-1 text-subtle hover:text-text" onClick={() => toggle(c.id, c.archived)} aria-label={c.archived ? `Restaurar ${c.name}` : `Archivar ${c.name}`}>
                {c.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              </button>
              <button className="p-1 text-subtle hover:text-danger" onClick={() => remove(c.id)} aria-label={`Eliminar ${c.name}`}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
