import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { useFinance } from "@/hooks/useFinance";
import { formatMoney } from "@/lib/money";
import {
  accountBalances,
  budgetProgress,
  budgetWindow,
  periodSummary,
  recurringStatus,
  totalsByCurrency,
} from "@/services/finance/calc";
import { rangeFor, todayKey } from "@/services/finance/dates";
import { useT } from "@/lib/i18n";

/** Resumen financiero para el dashboard general: una lectura, sin gráficos pesados. */
export function FinanceWidget() {
  const t = useT();
  const { data, state, currency } = useFinance();
  const today = todayKey();

  const info = useMemo(() => {
    if (!state || !data) return null;
    const month = rangeFor("month", today);
    const s = periodSummary(state, month, currency);
    const total = totalsByCurrency(state, accountBalances(state, today)).get(currency) ?? 0;
    const upcoming = state.finRecurring
      .filter((r) => r.kind === "expense")
      .flatMap((r) => {
        const st = recurringStatus(state, r, today, 7);
        return [...st.overdue, ...st.upcoming].map((o) => ({ ...o, r }));
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    const alerts = state.finBudgets
      .filter((b) => b.status === "active" && b.kind === "spending")
      .map((b) => {
        const w = budgetWindow(b, today);
        return w ? { b, p: budgetProgress(state, b, w, today) } : null;
      })
      .filter((x) => x && (x.p.state === "exceeded" || x.p.state === "warning"));
    return { s, total, upcoming, alerts };
  }, [state, data, currency, today]);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Wallet size={16} aria-hidden /> {t("dash.finance")}
        </CardTitle>
        <Link to="/finanzas" className="text-xs text-primary flex items-center gap-1">
          {t("dash.see")} <ArrowRight size={12} />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {!data || data.accounts.length === 0 || !info ? (
          <p className="text-sm text-subtle text-center py-6">
            {t("dash.noFinance")}{" "}
            <Link to="/finanzas?tab=accounts" className="text-primary">
              →
            </Link>
          </p>
        ) : (
          <>
            <div>
              <div className="text-xs text-subtle uppercase tracking-wide">{t("dash.balance")}</div>
              <div className="text-2xl font-semibold tabular-nums">{formatMoney(info.total, currency)}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-xs text-subtle">{t("dash.income")}</div>
                <div className="font-medium tabular-nums">{formatMoney(info.s.income, currency, { compact: true })}</div>
              </div>
              <div>
                <div className="text-xs text-subtle">{t("dash.expense")}</div>
                <div className="font-medium tabular-nums">{formatMoney(info.s.expense, currency, { compact: true })}</div>
              </div>
            </div>
            {info.alerts.map((x) => (
              <p key={x!.b.id} className="text-xs flex items-center gap-1.5 text-warning">
                <AlertTriangle size={12} aria-hidden /> «{x!.b.name}» al {x!.p.pct.toFixed(0)} %
              </p>
            ))}
            {info.upcoming.length > 0 && (
              <div>
                <div className="text-xs text-subtle mb-1">{t("dash.upcomingPayments")}</div>
                <ul className="space-y-1">
                  {info.upcoming.slice(0, 3).map((o) => (
                    <li key={o.txId} className="flex justify-between text-sm gap-2">
                      <span className={o.status === "overdue" ? "truncate text-danger" : "truncate"}>{o.r.name}</span>
                      <span className="text-xs text-subtle shrink-0">
                        {new Date(`${o.date}T12:00:00`).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
