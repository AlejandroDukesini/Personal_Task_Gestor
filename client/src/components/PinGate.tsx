import { useEffect, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { useConfig } from "@/store/config";
import { useT } from "@/lib/i18n";
import { api } from "@/services/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const SESSION_KEY = "gt-unlocked";
const ATTEMPTS_KEY = "gt-pin-attempts";
const LOCK_UNTIL_KEY = "gt-pin-locked-until";

// Tras 5 fallos se bloquea el formulario con espera creciente (30s, 60s,
// 120s... hasta 15 min). Frena el intento de adivinar un PIN de 4 dígitos
// -- 10.000 combinaciones -- por parte de quien tiene el equipo delante.
// No es una defensa contra alguien con acceso a las DevTools: ese atacante
// lee localStorage directamente, sin pasar por esta pantalla.
const FREE_ATTEMPTS = 5;
const MAX_LOCK_MS = 15 * 60 * 1000;

function lockDelay(failures: number): number {
  const over = failures - FREE_ATTEMPTS;
  if (over < 0) return 0;
  return Math.min(30000 * 2 ** over, MAX_LOCK_MS);
}

function readNumber(key: string): number {
  const n = Number(sessionStorage.getItem(key));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function PinGate({ children }: { children: ReactNode }) {
  const t = useT();
  const loaded = useConfig((s) => s.loaded);
  const pinEnabled = useConfig((s) => s.pinEnabled);
  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem(SESSION_KEY) === "1"
  );
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(() => readNumber(LOCK_UNTIL_KEY));
  const [now, setNow] = useState(() => Date.now());

  // Mantiene vivo el contador mientras dura el bloqueo.
  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  const remainingMs = Math.max(0, lockedUntil - now);

  // Esperar a conocer el estado real del PIN antes de decidir.
  if (!loaded) return null;
  if (!pinEnabled || unlocked) return <>{children}</>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin || remainingMs > 0) return;
    setChecking(true);
    setError(false);
    try {
      const { ok } = await api.post<{ ok: boolean }>("/settings/pin/verify", { pin });
      if (ok) {
        sessionStorage.removeItem(ATTEMPTS_KEY);
        sessionStorage.removeItem(LOCK_UNTIL_KEY);
        setLockedUntil(0);
        sessionStorage.setItem(SESSION_KEY, "1");
        setUnlocked(true);
      } else {
        const failures = readNumber(ATTEMPTS_KEY) + 1;
        sessionStorage.setItem(ATTEMPTS_KEY, String(failures));
        const delay = lockDelay(failures);
        if (delay > 0) {
          const until = Date.now() + delay;
          sessionStorage.setItem(LOCK_UNTIL_KEY, String(until));
          setLockedUntil(until);
          setNow(Date.now());
        }
        setError(true);
        setPin("");
      }
    } catch {
      // Un fallo al verificar nunca debe abrir la puerta.
      setError(true);
      setPin("");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg text-text px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-surface border border-border rounded-2xl p-8 space-y-5 text-center shadow-lg"
      >
        <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
          <Lock size={26} />
        </div>
        <div>
          <h1 className="text-xl font-semibold">{t("lock.title")}</h1>
          <p className="text-sm text-subtle mt-1">{t("lock.subtitle")}</p>
        </div>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={32}
          autoFocus
          disabled={remainingMs > 0}
          value={pin}
          placeholder={t("lock.placeholder")}
          onChange={(e) => {
            setPin(e.target.value);
            setError(false);
          }}
          className="text-center tracking-widest"
        />
        {remainingMs > 0 ? (
          <p className="text-sm text-red-500" role="alert">
            Demasiados intentos fallidos. Espera {Math.ceil(remainingMs / 1000)} s.
          </p>
        ) : (
          error && (
            <p className="text-sm text-red-500" role="alert">
              {t("lock.wrong")}
            </p>
          )
        )}
        <Button type="submit" className="w-full" disabled={checking || !pin || remainingMs > 0}>
          {t("lock.unlock")}
        </Button>
      </form>
    </div>
  );
}
