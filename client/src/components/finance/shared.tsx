import { useEffect, useState, type ReactNode } from "react";
import {
  Banknote,
  Briefcase,
  Car,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleEllipsis,
  CreditCard,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Landmark,
  Plane,
  PiggyBank,
  Repeat,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Tag,
  TrendingUp,
  Utensils,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Input, Select } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { formatMoney, parseMoney, toInputValue } from "@/lib/money";
import {
  rangeFor,
  shiftRange,
  todayKey,
  type DateRange,
  type RangePreset,
} from "@/services/finance/dates";
import type { FinAccountType, FinTxKind } from "@/services/localDb";

export const ACCOUNT_TYPE_LABEL: Record<FinAccountType, string> = {
  cash: "Efectivo",
  bank: "Banco",
  savings: "Ahorro",
  credit_card: "Tarjeta de crédito",
  wallet: "Billetera digital",
  investment: "Inversión",
  other: "Personalizada",
};

export const KIND_LABEL: Record<FinTxKind, string> = {
  income: "Ingreso",
  expense: "Gasto",
  transfer: "Transferencia",
  adjustment: "Corrección",
};

export const FREQUENCY_LABEL: Record<string, string> = {
  daily: "Diario",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
  quarterly: "Trimestral",
  yearly: "Anual",
  custom: "Personalizado",
};

/**
 * Iconos disponibles para cuentas, categorías y metas. Lista cerrada a
 * propósito: importar lucide entero para resolver nombres dinámicos metería
 * cientos de KB en el bundle.
 */
export const FIN_ICONS: Record<string, LucideIcon> = {
  Banknote,
  Briefcase,
  Car,
  Circle,
  CircleEllipsis,
  CreditCard,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Landmark,
  Plane,
  PiggyBank,
  Repeat,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Tag,
  TrendingUp,
  Utensils,
  Wallet,
  Zap,
};

/** Icono por nombre, con reserva si el nombre no está en la lista. */
export function DynIcon({ name, size = 16, className }: { name?: string | null; size?: number; className?: string }) {
  const Icon = (name && FIN_ICONS[name]) || Circle;
  return <Icon size={size} className={className} aria-hidden />;
}

/** Importe con color semántico por signo y texto accesible. */
export function Money({
  cents,
  currency,
  signed,
  compact,
  className,
  tone = "auto",
}: {
  cents: number;
  currency: string;
  signed?: boolean;
  compact?: boolean;
  className?: string;
  tone?: "auto" | "none";
}) {
  const color = tone === "none" ? "" : cents < 0 ? "text-danger" : cents > 0 && signed ? "text-success" : "";
  return (
    <span className={cn("tabular-nums whitespace-nowrap", color, className)}>
      {formatMoney(cents, currency, { signed, compact })}
    </span>
  );
}

/**
 * Campo de importe. Guarda céntimos enteros; muestra lo que el usuario teclea
 * sin reformatear mientras escribe (reformatear moviendo el cursor es la
 * forma más rápida de que alguien meta 10 veces el importe).
 */
export function MoneyInput({
  value,
  onChange,
  currency,
  allowNegative,
  id,
  required,
  autoFocus,
  ariaLabel,
}: {
  value: number | null;
  onChange: (cents: number | null) => void;
  currency: string;
  allowNegative?: boolean;
  id?: string;
  required?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(() => toInputValue(value));
  const [error, setError] = useState(false);

  // Si el valor cambia desde fuera (otro registro), se refleja.
  useEffect(() => {
    if (parseMoney(text) !== value) setText(toInputValue(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        required={required}
        aria-label={ariaLabel}
        aria-invalid={error || undefined}
        value={text}
        placeholder="0"
        className={cn("pr-14 tabular-nums", error && "border-danger")}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const cents = t.trim() === "" ? null : parseMoney(t);
          const bad = t.trim() !== "" && (cents === null || (!allowNegative && cents < 0));
          setError(bad);
          onChange(bad ? null : cents);
        }}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-subtle pointer-events-none">
        {currency}
      </span>
    </div>
  );
}

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: "day", label: "Día" },
  { id: "week", label: "Semana" },
  { id: "month", label: "Mes" },
  { id: "quarter", label: "Trimestre" },
  { id: "year", label: "Año" },
  { id: "custom", label: "Rango" },
];

export interface PeriodValue {
  preset: RangePreset;
  range: DateRange;
}

export function defaultPeriod(): PeriodValue {
  return { preset: "month", range: rangeFor("month", todayKey()) };
}

export function periodLabel(p: PeriodValue): string {
  const f = (k: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(`${k}T12:00:00`).toLocaleDateString("es-CO", opts);
  switch (p.preset) {
    case "day":
      return f(p.range.from, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    case "month":
      return f(p.range.from, { month: "long", year: "numeric" });
    case "year":
      return p.range.from.slice(0, 4);
    case "quarter":
      return `T${Math.floor(Number(p.range.from.slice(5, 7)) / 3) + 1} ${p.range.from.slice(0, 4)}`;
    default:
      return `${f(p.range.from, { day: "numeric", month: "short" })} – ${f(p.range.to, { day: "numeric", month: "short", year: "numeric" })}`;
  }
}

/** Filtro temporal: presets + navegación anterior/siguiente + rango libre. */
export function PeriodFilter({ value, onChange }: { value: PeriodValue; onChange: (v: PeriodValue) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-border overflow-x-auto max-w-full" role="group" aria-label="Periodo">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={value.preset === p.id}
            onClick={() =>
              onChange({
                preset: p.id,
                range: p.id === "custom" ? value.range : rangeFor(p.id, todayKey()),
              })
            }
            className={cn(
              "px-3 h-9 text-sm whitespace-nowrap",
              value.preset === p.id ? "bg-primary text-primary-fg" : "hover:bg-muted"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value.preset === "custom" ? (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="Desde"
            value={value.range.from}
            max={value.range.to}
            onChange={(e) => e.target.value && onChange({ ...value, range: { ...value.range, from: e.target.value } })}
            className="w-auto"
          />
          <span className="text-subtle text-sm">a</span>
          <Input
            type="date"
            aria-label="Hasta"
            value={value.range.to}
            min={value.range.from}
            onChange={(e) => e.target.value && onChange({ ...value, range: { ...value.range, to: e.target.value } })}
            className="w-auto"
          />
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="p-2 rounded-md hover:bg-muted"
            aria-label="Periodo anterior"
            onClick={() => onChange({ ...value, range: shiftRange(value.preset, value.range, -1) })}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-medium min-w-[9rem] text-center capitalize">{periodLabel(value)}</span>
          <button
            type="button"
            className="p-2 rounded-md hover:bg-muted"
            aria-label="Periodo siguiente"
            onClick={() => onChange({ ...value, range: shiftRange(value.preset, value.range, 1) })}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

export function StatTile({
  label,
  children,
  hint,
  icon: Icon,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="gt-surface p-4 min-w-0">
      <div className="flex items-center gap-2 text-xs text-subtle uppercase tracking-wide">
        {Icon && <Icon size={14} aria-hidden />}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-xl sm:text-2xl font-semibold mt-1 truncate">{children}</div>
      {hint && <div className="text-xs text-subtle mt-1 truncate">{hint}</div>}
    </div>
  );
}

/** Selector de cuenta agrupado por activas; muestra moneda. */
export function AccountSelect({
  accounts,
  value,
  onChange,
  id,
  allowEmpty,
  emptyLabel = "—",
  exclude,
  includeArchivedId,
}: {
  accounts: { id: string; name: string; currency: string; archived: boolean }[];
  value: string;
  onChange: (id: string) => void;
  id?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  exclude?: string;
  includeArchivedId?: string | null;
}) {
  const list = accounts.filter((a) => a.id !== exclude && (!a.archived || a.id === includeArchivedId));
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {list.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name} ({a.currency}){a.archived ? " · archivada" : ""}
        </option>
      ))}
    </Select>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    // Con más de 3 opciones, en móvil pasa a rejilla 2×2 en vez de recortarse.
    <div
      className={cn(
        "rounded-lg border border-border overflow-hidden",
        options.length > 3 ? "grid grid-cols-2 sm:flex" : "flex"
      )}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex-1 px-3 h-9 text-sm whitespace-nowrap",
            value === o.id ? "bg-primary text-primary-fg" : "hover:bg-muted"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Ha ocurrido un error";
}
