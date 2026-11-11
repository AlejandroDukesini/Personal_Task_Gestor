import toast from "react-hot-toast";

/** Ejecuta una acción, avisa con un mensaje discreto (éxito o error) y recarga. */
export async function runAction(fn: () => Promise<unknown>, message: string, reload: () => void): Promise<boolean> {
  try {
    await fn();
    toast.success(message);
    reload();
    return true;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Ha ocurrido un error");
    return false;
  }
}
