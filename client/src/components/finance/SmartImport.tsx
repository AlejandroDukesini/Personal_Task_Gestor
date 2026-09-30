import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, ChevronDown, Download, Pencil, Save, ShieldQuestion, Sparkles, Trash2, Wand2, X, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/services/api";
import type { FinanceData } from "@/hooks/useFinance";
import { CURRENCIES, formatMoney } from "@/lib/money";
import { FIELD_LABEL, IMPORT_FIELDS, type ColumnMapping, type ImportField } from "@/services/finance/import/columns";
import { CASHEW_PROFILE_HEADERS, deleteProfile, findProfile, profileMapping, saveProfile, type MappingProfile } from "@/services/finance/import/profiles";
import { importReportCsv, rejectedRowsCsv, rejectionReason, RESOLUTION_LABEL, STATUS_LABEL, fieldLabel } from "@/services/finance/import/report";
import type { DetectedFile } from "@/services/finance/import/sources";
import {
  DEFAULT_OPTIONS,
  DUPLICATE_FIELDS,
  type ConfirmationKey,
  type DuplicateField,
  type EditableField,
  type EntityChoice,
  type ImportOptions,
  type PreviewRow,
  type RowStatus,
  type SmartImportResult,
  type SmartPreview,
} from "@/services/finance/import/types";
import { KIND_LABEL, errorMessage } from "./shared";

const STATUS_COLOR: Record<RowStatus, string> = {
  valid: "#16a34a",
  fixed: "#2563eb",
  warning: "#d97706",
  error: "#dc2626",
  duplicate: "#7c3aed",
  excluded: "#64748b",
  merged: "#64748b",
};

const SEVERITY_CLASS = { error: "text-danger", warning: "text-warning", fixed: "text-subtle" } as const;

const DUP_LABEL: Record<DuplicateField, string> = { date: "Fecha", account: "Cuenta", kind: "Tipo", amount: "Importe", concept: "Concepto", category: "Categoría" };

type Filter = "all" | "import" | RowStatus;
const PAGE = 50;

const EDIT_FIELDS: { field: EditableField; label: string; placeholder?: string }[] = [
  { field: "date", label: "Fecha", placeholder: "AAAA-MM-DD" },
  { field: "amount", label: "Importe", placeholder: "1234,56" },
  { field: "kind", label: "Tipo", placeholder: "ingreso, gasto, transferencia, corrección" },
  { field: "account", label: "Cuenta" },
  { field: "toAccount", label: "Cuenta destino" },
  { field: "toAmount", label: "Importe recibido" },
  { field: "currency", label: "Moneda", placeholder: "COP" },
  { field: "category", label: "Categoría" },
  { field: "concept", label: "Concepto" },
  { field: "description", label: "Descripción" },
];

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Opciones de un perfil guardado sobre las predeterminadas (descartando cuentas que ya no existen). */
function optionsFromProfile(p: MappingProfile, accountIds: Set<string>): ImportOptions {
  const o = Object.fromEntries(Object.entries(p.options).filter(([, v]) => v !== undefined)) as Partial<ImportOptions>;
  const valid = (m?: Record<string, string>) => Object.fromEntries(Object.entries(m ?? {}).filter(([, v]) => !v.startsWith("id:") || accountIds.has(v.slice(3)))) as Record<string, EntityChoice>;
  return {
    ...DEFAULT_OPTIONS,
    ...o,
    defaultAccountId: o.defaultAccountId && accountIds.has(o.defaultAccountId) ? o.defaultAccountId : null,
    accountMap: valid(p.options.accountMap),
    categoryMap: (p.options.categoryMap ?? {}) as Record<string, EntityChoice>,
  };
}

export function SmartImport({ detected, data, reload, onClose }: { detected: Exclude<DetectedFile, { kind: "native" }>; data: FinanceData; reload: () => void; onClose: () => void }) {
  const [tableIdx, setTableIdx] = useState(0);
  const source = detected.kind === "cashew" ? detected.source : detected.tables[tableIdx];
  const profileHeaders = source.type === "table" ? source.headers : CASHEW_PROFILE_HEADERS;
  const [mapping, setMapping] = useState<ColumnMapping | undefined>();
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_OPTIONS);
  const [edits, setEdits] = useState<Record<string, Partial<Record<EditableField, string>>>>({});
  const [decisions, setDecisions] = useState<Record<string, "include" | "exclude">>({});
  const [preview, setPreview] = useState<SmartPreview | null>(null);
  const [profile, setProfile] = useState<MappingProfile | null>(null);
  const [profileName, setProfileName] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<SmartImportResult | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [showMore, setShowMore] = useState(false);

  // Al cambiar de hoja/tabla: se aplica el perfil guardado que encaje, si lo hay.
  useEffect(() => {
    setEdits({});
    setDecisions({});
    setEditing(null);
    const p = findProfile(profileHeaders);
    setProfile(p);
    setMapping(p && source.type === "table" ? profileMapping(p, source.headers) : undefined);
    setOptions(p ? optionsFromProfile(p, new Set(data.accounts.map((a) => a.id))) : DEFAULT_OPTIONS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useEffect(() => {
    let stale = false;
    api
      .post<SmartPreview>("/finance/import/smart/preview", { source, mapping, options, edits, decisions })
      .then((p) => {
        if (stale) return;
        setPreview(p);
        // Sin columnas imprescindibles o con columnas deducidas, se abre el apartado de columnas.
        if (p.fileIssues.some((i) => i.severity === "error" && i.field !== "file") || p.confirmations.some((c) => c.key === "mapping")) setShowColumns(true);
      })
      .catch((e) => !stale && toast.error(errorMessage(e)));
    return () => {
      stale = true;
    };
  }, [source, mapping, options, edits, decisions]);

  const rows = useMemo(() => {
    if (!preview) return [];
    if (filter === "all") return preview.rows;
    if (filter === "import") return preview.rows.filter((r) => r.included);
    return preview.rows.filter((r) => r.status === filter);
  }, [preview, filter]);
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);

  const set = <K extends keyof ImportOptions>(key: K, value: ImportOptions[K]) => setOptions((o) => ({ ...o, [key]: value }));
  const confirm = (key: ConfirmationKey) => setOptions((o) => ({ ...o, confirmed: [...new Set([...o.confirmed, key])] }));

  function setField(i: number, f: ImportField | null) {
    const base = [...(mapping ?? preview?.mapping ?? [])];
    // Un campo solo puede venir de una columna.
    if (f) base.forEach((x, j) => x === f && j !== i && (base[j] = null));
    base[i] = f;
    setMapping(base);
  }

  function decide(r: PreviewRow, include: boolean) {
    setDecisions((d) => ({ ...d, [r.row]: include ? "include" : "exclude" }));
  }

  function bulk(pred: (r: PreviewRow) => boolean, choice: "include" | "exclude") {
    if (!preview) return;
    const next = { ...decisions };
    for (const r of preview.rows) if (r.canInclude && pred(r)) next[r.row] = choice;
    setDecisions(next);
  }

  function toggleDetails(row: number) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(row)) n.delete(row);
      else n.add(row);
      return n;
    });
  }

  function doSaveProfile() {
    if (!preview) return;
    const fallbackName = detected.kind === "cashew" ? "Cashew" : detected.label.split(" · ")[0];
    const p = saveProfile(profileName || profile?.name || fallbackName, profileHeaders, preview.mapping, options);
    setProfile(p);
    setProfileName("");
    toast.success(`Preferencias «${p.name}» guardadas: se aplicarán solas la próxima vez`);
  }

  async function apply() {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await api.post<SmartImportResult>("/finance/import/smart", { source, mapping, options, edits, decisions });
      setResult(res);
      setConfirmOpen(false);
      toast.success(`${res.imported} movimiento(s) importados`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const reportName = `informe-importacion-${stamp}.csv`;
  const rejectedName = `filas-no-importadas-${stamp}.csv`;
  const accounts = data.accounts.filter((a) => !a.archived);

  if (result) {
    const t = result.totals;
    const notImported = result.rows.filter((r) => !r.included && r.status !== "merged");
    const fixed = result.rows.filter((r) => r.included && r.status === "fixed").length;
    return (
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
            <CheckCircle2 size={16} className="text-success" aria-hidden /> Importación completada
          </CardTitle>
          <CardDescription>{detected.label}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="Resultado">
            {[
              { label: "Importados", value: result.imported, color: "#16a34a" },
              { label: "Corregidos automáticamente", value: fixed, color: STATUS_COLOR.fixed },
              { label: "Omitidos (duplicados o excluidos)", value: t.duplicates + t.excluded, color: STATUS_COLOR.excluded },
              { label: "Rechazados por errores", value: t.errors, color: STATUS_COLOR.error },
            ].map((x) => (
              <li key={x.label} className="rounded-md border border-border p-2">
                <div className="text-lg font-semibold tabular-nums" style={{ color: x.color }}>
                  {x.value}
                </div>
                <div className="text-[11px] text-subtle leading-tight">{x.label}</div>
              </li>
            ))}
          </ul>
          {(result.newAccounts.length > 0 || result.newCategories.length > 0) && (
            <p className="text-xs text-subtle">
              {result.newAccounts.length > 0 && `Cuentas creadas: ${result.newAccounts.map((a) => a.name).join(", ")}. `}
              {result.newCategories.length > 0 && `Categorías creadas: ${result.newCategories.map((c) => c.name).join(", ")}.`}
            </p>
          )}
          {notImported.length > 0 && (
            <details className="gt-surface p-3">
              <summary className="cursor-pointer text-sm font-medium">Filas que no se importaron ({notImported.length})</summary>
              <ul className="mt-2 max-h-64 overflow-y-auto divide-y divide-border text-xs">
                {notImported.map((r) => (
                  <li key={r.row} className="py-1.5 flex gap-2">
                    <span className="tabular-nums text-subtle shrink-0">#{r.row}</span>
                    <Badge color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    <span className="min-w-0">{rejectionReason(r)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {notImported.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => download(rejectedName, rejectedRowsCsv(result))}>
                <Download size={14} /> Filas no importadas
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => download(reportName, importReportCsv(result))}>
              <Download size={14} /> Informe completo
            </Button>
            <Button size="sm" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const t = preview?.totals;
  const tiles: { key: Filter; label: string; value: number; color?: string }[] = t
    ? [
        { key: "all", label: "Filas", value: t.total },
        { key: "import", label: "Se importan", value: t.toImport, color: "#16a34a" },
        { key: "valid", label: "Válidas", value: t.valid, color: STATUS_COLOR.valid },
        { key: "fixed", label: "Autocorregidas", value: t.fixed, color: STATUS_COLOR.fixed },
        { key: "warning", label: "Advertencias", value: t.warnings, color: STATUS_COLOR.warning },
        { key: "error", label: "Errores", value: t.errors, color: STATUS_COLOR.error },
        { key: "duplicate", label: "Duplicadas", value: t.duplicates, color: STATUS_COLOR.duplicate },
        { key: "excluded", label: "Excluidas", value: t.excluded, color: STATUS_COLOR.excluded },
        ...(t.merged ? [{ key: "merged" as Filter, label: "Unidas", value: t.merged, color: STATUS_COLOR.merged }] : []),
      ]
    : [];

  const currencyOf = (r: PreviewRow) => (r.currency && /^[A-Z]{3}$/.test(r.currency) ? r.currency : data.defaultCurrency);
  const pending = preview?.confirmations ?? [];
  const unresolved = preview?.unresolved ?? { accounts: [], categories: [] };

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm sm:text-base">
            <Sparkles size={16} aria-hidden /> Importación inteligente
            {preview?.preset && <Badge color="#2563eb">{preview.preset}</Badge>}
            {profile && <Badge color="#0d9488">Preferencias: {profile.name}</Badge>}
          </CardTitle>
          <CardDescription className="truncate">
            {detected.label}
            {detected.kind === "cashew" ? ` · ${detected.summary}` : ""}
          </CardDescription>
        </div>
        <button className="text-subtle hover:text-text h-9 w-9 -m-1 flex items-center justify-center rounded-md shrink-0" onClick={onClose} aria-label="Cancelar importación">
          <X size={18} />
        </button>
      </CardHeader>
      <CardContent className="space-y-4">
        {preview?.fileIssues.length ? (
          <ul className="space-y-1 text-xs">
            {preview.fileIssues.map((i, k) => (
              <li key={k} className={SEVERITY_CLASS[i.severity]}>
                {i.severity === "error" ? "✖" : i.severity === "warning" ? "⚠" : "✔"} {i.message}
                {i.suggestion && <span className="text-subtle"> — {i.suggestion}</span>}
              </li>
            ))}
          </ul>
        ) : null}

        {pending.length > 0 && (
          <section className="rounded-md border border-warning/60 bg-warning/10 p-3 space-y-3" aria-label="Decisiones pendientes">
            <p className="text-sm font-medium flex items-center gap-2">
              <ShieldQuestion size={16} className="text-warning" aria-hidden /> Necesitamos tu confirmación antes de importar
            </p>
            {pending.map((c) => (
              <div key={c.key} className="text-xs space-y-2">
                <p>{c.message}</p>
                <p className="text-subtle">{c.proposal}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {c.key === "dateOrder" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => set("dateOrder", "dmy")}>
                        Son DD/MM/AAAA
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => set("dateOrder", "mdy")}>
                        Son MM/DD/AAAA
                      </Button>
                    </>
                  )}
                  {c.key === "decimal" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => set("decimal", ",")}>
                        Decimal con coma (1.234,56)
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => set("decimal", ".")}>
                        Decimal con punto (1,234.56)
                      </Button>
                    </>
                  )}
                  {c.key === "currency" && (
                    <>
                      {CURRENCIES.map((cur) => (
                        <Button key={cur.code} size="sm" variant={cur.code === data.defaultCurrency ? "primary" : "outline"} onClick={() => set("defaultCurrency", cur.code)}>
                          {cur.code}
                        </Button>
                      ))}
                    </>
                  )}
                  {c.key === "mapping" && (
                    <Button size="sm" onClick={() => preview && setMapping([...preview.mapping])}>
                      Las columnas son correctas
                    </Button>
                  )}
                  {c.key !== "mapping" && c.key !== "currency" && (
                    <Button size="sm" variant="ghost" onClick={() => confirm(c.key)}>
                      Confirmar la propuesta
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}

        {detected.kind === "tables" && detected.tables.length > 1 && (
          <Field label={detected.tables[0].format === "sqlite" || detected.tables[0].format === "sql" ? "Tabla" : "Hoja"}>
            <Select value={tableIdx} onChange={(e) => setTableIdx(Number(e.target.value))}>
              {detected.tables.map((tb, i) => (
                <option key={i} value={i}>
                  {tb.name ?? `Tabla ${i + 1}`} ({tb.rows.length} filas)
                </option>
              ))}
            </Select>
          </Field>
        )}

        {source.type === "table" && preview && (
          <section className="gt-surface p-3 space-y-3">
            <button className="w-full flex items-center justify-between text-sm font-medium" onClick={() => setShowColumns((v) => !v)} aria-expanded={showColumns}>
              <span>
                Columnas <span className="text-xs text-subtle font-normal">({preview.mapping.filter(Boolean).length} de {preview.headers.length} asignadas)</span>
              </span>
              <ChevronDown size={16} className={showColumns ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden />
            </button>
            {showColumns && (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {preview.headers.map((h, i) => {
                  const samples = source.rows
                    .map((r) => r[i])
                    .filter((v) => v !== null && v !== "")
                    .slice(0, 2)
                    .map((v) => String(v).slice(0, 24));
                  const how = preview.mappingSource[i];
                  return (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{h}</div>
                        <div className="text-subtle truncate">{samples.join(" · ") || "vacía"}</div>
                      </div>
                      {how && (
                        <span className={how === "content" ? "text-[10px] text-warning shrink-0 font-medium" : "text-[10px] text-subtle shrink-0"}>
                          {how === "preset" ? "perfil predefinido" : how === "profile" ? "tu elección" : how === "header" ? "por nombre" : "por contenido · revisa"}
                        </span>
                      )}
                      <Select aria-label={`Campo para la columna ${h}`} className="w-44 shrink-0 text-xs" value={preview.mapping[i] ?? ""} onChange={(e) => setField(i, (e.target.value || null) as ImportField | null)}>
                        <option value="">— Ignorar —</option>
                        {IMPORT_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {FIELD_LABEL[f]}
                          </option>
                        ))}
                      </Select>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {(unresolved.accounts.length > 0 || unresolved.categories.length > 0) && (
          <section className="gt-surface p-3 space-y-3" aria-label="Cuentas y categorías del archivo">
            <p className="text-sm font-medium">Cuentas y categorías del archivo que no existen en la app</p>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {unresolved.accounts.map((a) => (
                <li key={`a-${a.key}`} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">Cuenta «{a.name}»</div>
                    <div className="text-subtle">
                      {a.rows} fila(s){a.currency ? ` · ${a.currency}` : ""}
                    </div>
                  </div>
                  <Select
                    aria-label={`Qué hacer con la cuenta ${a.name}`}
                    className="w-48 shrink-0 text-xs"
                    value={options.accountMap[a.key] ?? a.choice}
                    onChange={(e) => set("accountMap", { ...options.accountMap, [a.key]: e.target.value as EntityChoice })}
                  >
                    <option value="create">Crear cuenta nueva</option>
                    {accounts.map((x) => (
                      <option key={x.id} value={`id:${x.id}`}>
                        Usar «{x.name}» ({x.currency})
                      </option>
                    ))}
                    <option value="exclude">No importar sus filas</option>
                  </Select>
                </li>
              ))}
              {unresolved.categories.map((c) => (
                <li key={`c-${c.key}`} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">Categoría «{c.name}»</div>
                    <div className="text-subtle">
                      {c.rows} fila(s) · {c.kind === "income" ? "ingresos" : c.kind === "expense" ? "gastos" : "ingresos y gastos"}
                    </div>
                  </div>
                  <Select
                    aria-label={`Qué hacer con la categoría ${c.name}`}
                    className="w-48 shrink-0 text-xs"
                    value={options.categoryMap[c.key] ?? c.choice}
                    onChange={(e) => set("categoryMap", { ...options.categoryMap, [c.key]: e.target.value as EntityChoice })}
                  >
                    <option value="create">Crear categoría nueva</option>
                    {data.categories
                      .filter((x) => !x.archived && (x.kind === "both" || c.kind === "both" || x.kind === c.kind))
                      .map((x) => (
                        <option key={x.id} value={`id:${x.id}`}>
                          Usar «{x.name}»
                        </option>
                      ))}
                    <option value="none">Dejar sin categoría</option>
                    <option value="exclude">No importar sus filas</option>
                  </Select>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 items-end">
          <Field label="Fechas">
            <Select value={options.dateOrder} onChange={(e) => set("dateOrder", e.target.value as ImportOptions["dateOrder"])}>
              <option value="auto">Automático{preview ? ` (${preview.detected.dateOrder === "mdy" ? "MM/DD" : "DD/MM"})` : ""}</option>
              <option value="dmy">DD/MM/AAAA</option>
              <option value="mdy">MM/DD/AAAA</option>
            </Select>
          </Field>
          <Field label="Decimales">
            <Select value={options.decimal} onChange={(e) => set("decimal", e.target.value as ImportOptions["decimal"])}>
              <option value="auto">Automático{preview?.detected.decimal ? ` («${preview.detected.decimal}»)` : ""}</option>
              <option value=",">Coma: 1.234,56</option>
              <option value=".">Punto: 1,234.56</option>
            </Select>
          </Field>
          <Field label="Cuenta por defecto">
            <Select value={options.defaultAccountId ?? ""} onChange={(e) => set("defaultAccountId", e.target.value || null)}>
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-xs pb-2">
            <input type="checkbox" className="accent-primary" checked={options.createAccounts} onChange={(e) => set("createAccounts", e.target.checked)} />
            Crear cuentas que falten
          </label>
          <label className="flex items-center gap-2 text-xs pb-2">
            <input type="checkbox" className="accent-primary" checked={options.createCategories} onChange={(e) => set("createCategories", e.target.checked)} />
            Crear categorías que falten
          </label>
        </section>

        <section className="gt-surface p-3 space-y-3">
          <button className="w-full flex items-center justify-between text-sm font-medium" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>
            <span>Más opciones y preferencias</span>
            <ChevronDown size={16} className={showMore ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden />
          </button>
          {showMore && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                <Field label="Zona horaria de fechas con hora" hint="Para timestamps y fechas con zona (Z, +02:00). La app guarda solo el día.">
                  <Select value={options.zone} onChange={(e) => set("zone", e.target.value as ImportOptions["zone"])}>
                    <option value="local">Día según este dispositivo</option>
                    <option value="utc">Día en UTC</option>
                  </Select>
                </Field>
                <Field label="Moneda de cuentas nuevas" hint="Solo si el archivo no la indica.">
                  <Select value={options.defaultCurrency ?? ""} onChange={(e) => set("defaultCurrency", e.target.value || null)}>
                    <option value="">Preguntar ({data.defaultCurrency})</option>
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <label className="flex items-start gap-2 text-xs pb-2">
                  <input type="checkbox" className="accent-primary mt-0.5" checked={options.allowRounding} onChange={(e) => set("allowRounding", e.target.checked)} />
                  Permitir redondear a 2 decimales los importes que tengan más (si no, esas filas se omiten salvo que las marques)
                </label>
              </div>
              <fieldset className="text-xs">
                <legend className="text-xs font-medium text-subtle uppercase tracking-wide mb-1">Campos que definen un posible duplicado</legend>
                <div className="flex flex-wrap gap-3">
                  {DUPLICATE_FIELDS.map((f) => (
                    <label key={f} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={options.duplicateFields.includes(f)}
                        onChange={(e) => set("duplicateFields", e.target.checked ? [...options.duplicateFields, f] : options.duplicateFields.filter((x) => x !== f).length ? options.duplicateFields.filter((x) => x !== f) : options.duplicateFields)}
                      />
                      {DUP_LABEL[f]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[12rem]">
                  <Field label="Guardar como preferencias" hint="Columnas y opciones se aplicarán solas a los archivos del mismo origen (solo en este dispositivo).">
                    <Input value={profileName} maxLength={60} placeholder={profile?.name ?? (detected.kind === "cashew" ? "Cashew" : "Ej.: Extracto Bancolombia")} onChange={(e) => setProfileName(e.target.value)} />
                  </Field>
                </div>
                <Button variant="outline" size="sm" onClick={doSaveProfile} className="mb-6">
                  <Save size={14} /> {profile ? "Actualizar" : "Guardar"}
                </Button>
                {profile && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mb-6"
                    onClick={() => {
                      deleteProfile(profile.id);
                      setProfile(null);
                      toast.success("Preferencias eliminadas");
                    }}
                  >
                    <Trash2 size={14} /> Olvidar
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>

        {t && (
          <section aria-label="Resumen" className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
            {tiles.map((tile) => (
              <button
                key={tile.key}
                onClick={() => {
                  setFilter(tile.key);
                  setPage(0);
                }}
                aria-pressed={filter === tile.key}
                className={`rounded-md border p-2 text-left transition-colors ${filter === tile.key ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
              >
                <div className="text-lg font-semibold tabular-nums" style={tile.color ? { color: tile.color } : undefined}>
                  {tile.value}
                </div>
                <div className="text-[11px] text-subtle leading-tight">{tile.label}</div>
              </button>
            ))}
          </section>
        )}

        {preview && (preview.newAccounts.length > 0 || preview.newCategories.length > 0) && (
          <p className="text-xs text-subtle">
            {preview.newAccounts.length > 0 && <>Se crearán {preview.newAccounts.length} cuenta(s): {preview.newAccounts.map((a) => `${a.name} (${a.currency})`).join(", ")}. </>}
            {preview.newCategories.length > 0 && <>Se crearán {preview.newCategories.length} categoría(s): {preview.newCategories.map((c) => c.name).join(", ")}.</>}
          </p>
        )}

        {preview && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => bulk((r) => r.status === "warning", "exclude")} disabled={!t?.warnings}>
              Excluir filas con advertencias
            </Button>
            <Button size="sm" variant="ghost" onClick={() => bulk((r) => r.duplicate === "fingerprint" || r.duplicate === "deleted" || r.duplicate === "exact", "include")} disabled={!preview.rows.some((r) => r.canInclude && r.duplicate)}>
              Importar también los posibles duplicados
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDecisions({})} disabled={!Object.keys(decisions).length}>
              Restablecer selección
            </Button>
          </div>
        )}

        {preview && (
          <ul className="divide-y divide-border border border-border rounded-md text-sm">
            {pageRows.length === 0 && <li className="p-3 text-xs text-subtle">No hay filas en esta vista.</li>}
            {pageRows.map((r) => {
              const errors = r.issues.filter((i) => i.severity === "error");
              const others = r.issues.filter((i) => i.severity !== "error");
              const open = expanded.has(r.row);
              return (
                <li key={r.row} className={r.status === "merged" ? "p-2 opacity-60" : "p-2"}>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="accent-primary mt-1"
                      checked={r.included}
                      disabled={!r.canInclude}
                      onChange={(e) => decide(r, e.target.checked)}
                      aria-label={`Importar fila ${r.row}`}
                      title={r.canInclude ? "Importar esta fila" : "Esta fila no se puede importar tal cual"}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-xs text-subtle tabular-nums">#{r.row}</span>
                        <span className="text-xs tabular-nums">{r.date ?? "sin fecha"}</span>
                        <Badge color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                        {r.kind && <span className="text-xs text-subtle">{KIND_LABEL[r.kind as keyof typeof KIND_LABEL] ?? r.kind}</span>}
                      </div>
                      <div className="truncate">
                        {r.concept}
                        <span className="text-subtle text-xs">
                          {" "}
                          · {r.account ?? "sin cuenta"}
                          {r.toAccount ? ` → ${r.toAccount}` : ""}
                          {r.category ? ` · ${r.category}` : ""}
                        </span>
                      </div>
                      {errors.map((i, k) => (
                        <p key={k} className="text-xs text-danger mt-0.5">
                          <span className="font-medium">{fieldLabel(i.field)}:</span> {i.message}
                          {i.suggestion && <span className="text-subtle"> — {i.suggestion}</span>}
                        </p>
                      ))}
                      {others.length > 0 && (
                        <button className="text-xs text-subtle hover:text-text mt-0.5 min-h-[24px]" onClick={() => toggleDetails(r.row)} aria-expanded={open}>
                          {open ? "Ocultar detalles" : `Ver detalles (${others.length})`}
                          {!open && others.some((i) => i.severity === "warning") && <span className="text-warning"> · {others.find((i) => i.severity === "warning")!.message}</span>}
                        </button>
                      )}
                      {open && (
                        <ul className="mt-1 space-y-0.5">
                          {others.map((i, k) => (
                            <li key={k} className={`text-xs ${SEVERITY_CLASS[i.severity]}`}>
                              <span className="font-medium">{fieldLabel(i.field)}:</span> {i.message}
                              {i.original && <span className="text-subtle"> (original: «{i.original}»)</span>}
                              {i.suggestion && <span className="text-subtle"> — {i.suggestion}</span>}
                              {i.resolution && <span className="text-subtle"> · {RESOLUTION_LABEL[i.resolution]}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="tabular-nums text-sm">{r.amount !== null ? formatMoney(r.amount, currencyOf(r)) : "—"}</span>
                      {r.status !== "merged" && (
                        <button className="text-xs text-subtle hover:text-text inline-flex items-center gap-1 min-h-[28px]" onClick={() => setEditing(editing === r.row ? null : r.row)} aria-expanded={editing === r.row}>
                          <Pencil size={12} /> Corregir
                        </button>
                      )}
                    </div>
                  </div>
                  {editing === r.row && (
                    <RowEditor
                      row={r}
                      edited={edits[r.row]}
                      onCancel={() => setEditing(null)}
                      onSave={(values) => {
                        setEdits((e) => ({ ...e, [r.row]: values }));
                        setEditing(null);
                      }}
                      onReset={() => {
                        setEdits((e) => {
                          const next = { ...e };
                          delete next[r.row];
                          return next;
                        });
                        setEditing(null);
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {rows.length > PAGE && (
          <div className="flex items-center justify-center gap-2 text-xs">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Anterior
            </Button>
            <span className="tabular-nums">
              {page * PAGE + 1}-{Math.min(rows.length, (page + 1) * PAGE)} de {rows.length}
            </span>
            <Button size="sm" variant="ghost" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>
              Siguiente
            </Button>
          </div>
        )}

        {preview && t && (
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {(t.errors > 0 || pending.length > 0) && (
              <p className="text-xs text-subtle mr-auto flex items-center gap-1">
                <AlertTriangle size={12} className="text-warning" aria-hidden />
                {pending.length > 0 ? "Responde a las confirmaciones pendientes para poder importar." : `${t.errors} fila(s) con errores no se importarán; corrígelas o descarga el informe.`}
              </p>
            )}
            <Button variant="outline" size="sm" onClick={() => download(reportName, importReportCsv(preview))}>
              <Download size={14} /> Informe de errores
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={!t.toImport || pending.length > 0}>
              <Wand2 size={14} /> Importar {t.toImport} movimiento(s)
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onClose={() => !busy && setConfirmOpen(false)} title="Confirmar importación" description="Revisa el resumen antes de guardar. Se guarda todo de una vez: si algo falla, no se guarda nada.">
        {preview && t && (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1">
              <li>
                Se importarán <strong>{t.toImport}</strong> movimiento(s).
              </li>
              {preview.newAccounts.length > 0 && <li>Se crearán {preview.newAccounts.length} cuenta(s): {preview.newAccounts.map((a) => a.name).join(", ")}.</li>}
              {preview.newCategories.length > 0 && <li>Se crearán {preview.newCategories.length} categoría(s).</li>}
              {t.errors > 0 && <li className="text-danger">{t.errors} fila(s) con errores no se importarán.</li>}
              {t.duplicates > 0 && <li className="text-subtle">{t.duplicates} duplicada(s) se omiten.</li>}
              {t.excluded > 0 && <li className="text-subtle">{t.excluded} excluida(s) se omiten.</li>}
            </ul>
            <p className="text-xs text-subtle">Las filas no importadas quedan en el informe para que puedas corregirlas y volver a importarlas; reimportar el mismo archivo no duplica lo ya importado.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>
                Volver
              </Button>
              <Button onClick={apply} loading={busy}>
                Importar {t.toImport}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Card>
  );
}

function RowEditor({
  row,
  edited,
  onSave,
  onCancel,
  onReset,
}: {
  row: PreviewRow;
  edited?: Partial<Record<EditableField, string>>;
  onSave: (v: Partial<Record<EditableField, string>>) => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const [values, setValues] = useState<Partial<Record<EditableField, string>>>(() => ({ ...row.raw, ...edited }));
  const bad = new Set(row.issues.filter((i) => i.severity !== "fixed").map((i) => i.field));
  return (
    <form
      className="mt-2 p-3 rounded-md bg-muted/50 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        // Solo se guardan los campos que cambian: el resto sigue leyéndose del archivo.
        const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== (row.raw[k as EditableField] ?? "") || edited?.[k as EditableField] !== undefined));
        onSave(changed);
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {EDIT_FIELDS.filter((f) => (f.field !== "toAccount" && f.field !== "toAmount" ? true : row.kind === "transfer" || !!values[f.field])).map((f) => (
          <Field key={f.field} label={f.label}>
            <Input
              value={values[f.field] ?? ""}
              placeholder={f.placeholder}
              aria-invalid={bad.has(f.field) || undefined}
              className={bad.has(f.field) ? "border-danger" : undefined}
              onChange={(e) => setValues({ ...values, [f.field]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {edited && (
          <Button type="button" size="sm" variant="ghost" onClick={onReset}>
            <XCircle size={14} /> Volver al original
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" size="sm">
          Aplicar corrección
        </Button>
      </div>
    </form>
  );
}
