import { useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { useConfig } from "@/store/config";
import { useT } from "@/lib/i18n";
import { api } from "@/services/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const SESSION_KEY = "gt-unlocked";

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

  // Esperar a conocer el estado real del PIN antes de decidir.
  if (!loaded) return null;
  if (!pinEnabled || unlocked) return <>{children}</>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin) return;
    setChecking(true);
    setError(false);
    try {
      const { ok } = await api.post<{ ok: boolean }>("/settings/pin/verify", { pin });
      if (ok) {
        sessionStorage.setItem(SESSION_KEY, "1");
        setUnlocked(true);
      } else {
        setError(true);
        setPin("");
      }
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
          autoFocus
          value={pin}
          placeholder={t("lock.placeholder")}
          onChange={(e) => {
            setPin(e.target.value);
            setError(false);
          }}
          className="text-center tracking-widest"
        />
        {error && <p className="text-sm text-red-500">{t("lock.wrong")}</p>}
        <Button type="submit" className="w-full" disabled={checking || !pin}>
          {t("lock.unlock")}
        </Button>
      </form>
    </div>
  );
}
