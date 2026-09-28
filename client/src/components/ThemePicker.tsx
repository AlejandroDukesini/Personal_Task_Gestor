import { Check, Monitor, Moon, Palette, Sun, Type, Wand2 } from "lucide-react";
import { Field } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/store/theme";
import { SKINS, skinMeta } from "@/themes/registry";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const COLORS = ["#6366f1", "#10b981", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

/**
 * Selector de skin + modo + acento. Itera sobre `SKINS`, así que un skin nuevo
 * aparece aquí automáticamente sin tocar este archivo.
 */
export function ThemePicker() {
  const t = useT();
  const {
    theme, setTheme,
    skin, setSkin,
    primaryColor, setPrimaryColor,
    useSkinAccent, useThemeAccent,
    fontScale, setFontScale,
  } = useTheme();

  const current = skinMeta(skin);

  return (
    <div className="space-y-5">
      <Field label={t("settings.skin")} hint={t("settings.skinHelp")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SKINS.map((s) => {
            const active = s.id === skin;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSkin(s.id)}
                aria-pressed={active}
                className={cn(
                  "gt-control text-left p-3 border border-theme relative overflow-hidden",
                  active ? "border-primary ring-2 ring-primary/40" : "border-border hover:bg-muted"
                )}
              >
                {/* Miniatura: reproduce fondo, superficie y acento del skin. */}
                <div
                  className="h-14 w-full rounded mb-2 flex items-end gap-1 p-1.5 border border-black/10"
                  style={{ background: s.swatch.bg }}
                >
                  <span
                    className="h-full flex-1 rounded-sm border border-black/10"
                    style={{ background: s.swatch.surface }}
                  />
                  <span className="h-full w-3 rounded-sm" style={{ background: s.swatch.accent }} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{s.name}</span>
                  {active && <Check size={14} className="text-primary shrink-0" />}
                </div>
                <p className="text-xs text-subtle mt-0.5 leading-snug">{s.description}</p>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={t("settings.theme")}>
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: "light", label: t("settings.themeLight"), Icon: Sun },
            { id: "dark", label: t("settings.themeDark"), Icon: Moon },
            { id: "system", label: t("settings.themeSystem"), Icon: Monitor },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              // Un skin de una sola cara (terminal) no admite modo claro.
              disabled={current.forceDark}
              onClick={() => setTheme(id as any)}
              className={cn(
                "gt-control flex flex-col items-center gap-1 p-3 border border-theme text-sm",
                theme === id && !current.forceDark
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-muted",
                current.forceDark && "opacity-40 cursor-not-allowed"
              )}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>
        {current.forceDark && (
          <p className="text-xs text-subtle mt-1.5">{t("settings.forcedDark")}</p>
        )}
      </Field>

      <Field label={t("settings.primaryColor")}>
        <div className="flex gap-2 flex-wrap items-center">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setPrimaryColor(c)}
              className="h-9 w-9 rounded-pill border-2 transition-transform"
              style={{
                background: c,
                borderColor:
                  !useSkinAccent && primaryColor === c ? "rgb(var(--text))" : "transparent",
                transform: !useSkinAccent && primaryColor === c ? "scale(1.1)" : "scale(1)",
              }}
            />
          ))}
          <Button
            type="button"
            variant={useSkinAccent ? "primary" : "outline"}
            size="sm"
            onClick={useThemeAccent}
            title={t("settings.useSkinAccentHelp")}
          >
            <Wand2 size={13} /> {t("settings.useSkinAccent")}
          </Button>
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

      <p className="text-xs text-subtle flex items-center gap-1.5">
        <Palette size={13} /> {t("settings.paletteHint")}
      </p>
    </div>
  );
}
