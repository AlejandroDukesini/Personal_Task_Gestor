import { useCallback, useEffect, useState } from "react";

export function useResource<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loader();
      setData(result);
    } catch (e: any) {
      setError(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  // Al restaurar una copia o un punto de restauración, el almacenamiento
  // cambia por debajo sin que la vista lo sepa: este evento la obliga a releer.
  useEffect(() => {
    const onSync = () => reload();
    window.addEventListener("gt:data-replaced", onSync);
    return () => window.removeEventListener("gt:data-replaced", onSync);
  }, [reload]);

  return { data, loading, error, reload, setData };
}
