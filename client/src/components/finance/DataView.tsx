import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { Archive, ArchiveRestore, Database, Download, FileJson, FileSpreadsheet, FileUp, Plus, Trash2, Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/services/api";
import { loadDb, type FinCategoryKind } from "@/services/localDb";
import type { FinanceData } from "@/hooks/useFinance";
import { transactionsToCsv, type ImportSummary } from "@/services/finance/io";
import { MAX_IMPORT_BYTES, readImportFile, type DetectedFile } from "@/services/finance/import/sources";
import { financeSqlDump } from "@/services/finance/sql";
import { DynIcon, errorMessage } from "./shared";
import { SmartImport } from "./SmartImport";

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
  const fileRef = useRef<HTMLInputElement>(null);
  const [jsonImport, setJsonImport] = useState<{ payload: unknown; mode: "newer" | "merge"; summary: ImportSummary } | null>(null);
  const [smart, setSmart] = useState<Exclude<DetectedFile, { kind: "native" }> | null>(null);
  const [reading, setReading] = useState(false);
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

  /**
   * Cualquier archivo: el formato se detecta por el contenido. Una copia JSON
   * de esta app va por la importación completa (todo o nada); el resto, por
   * la importación inteligente fila a fila.
   */
  async function pickFile(file: File) {
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error("El archivo supera 25 MB");
      return;
    }
    setReading(true);
    try {
      const detected = await readImportFile(file.name, new Uint8Array(await file.arrayBuffer()));
      if (detected.kind === "native") {
        setSmart(null);
        const summary = await api.post<ImportSummary>("/finance/import/preview", { data: detected.payload, mode: "newer" });
        setJsonImport({ payload: detected.payload, mode: "newer", summary });
      } else {
        setJsonImport(null);
        setSmart(detected);
      }
    } finally {
      setReading(false);
    }
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
            CSV, Excel (.xlsx), JSON o base de datos SQLite (incluidas las copias de Cashew). Cada fila se valida por separado y ves una vista previa antes de aplicar nada. Por seguridad nunca se ejecuta SQL importado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" onClick={() => fileRef.current?.click()} loading={reading}>
            <FileUp size={14} /> Elegir archivo
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.json,.sql,.sqlite,.db,.sqlite3,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) pickFile(f).catch((err) => toast.error(errorMessage(err)));
            }}
          />
          <p className="text-xs text-subtle">
            Las columnas se reconocen solas (fecha, importe, tipo, cuenta, categoría, concepto…) y puedes reasignarlas. Se aceptan fechas AAAA-MM-DD, DD/MM/AAAA, con hora o
            timestamps; importes con coma o punto decimal y símbolo de moneda. Los duplicados se detectan y reimportar el mismo archivo no duplica nada. La copia JSON de esta app
            restaura todo de una vez.
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

        </CardContent>
      </Card>

      {smart && <SmartImport key={smart.label} detected={smart} data={data} reload={reload} onClose={() => setSmart(null)} />}

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
