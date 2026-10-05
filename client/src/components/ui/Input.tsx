import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type TextareaHTMLAttributes, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// `.gt-field` aporta fondo, borde, radio y anillo de foco desde los tokens del
// skin; aquí solo queda el espaciado y la tipografía.
const baseField =
  "gt-field w-full px-3 py-2 text-sm text-text placeholder:text-subtle disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => (
    <input ref={ref} className={cn(baseField, "h-9", className)} {...rest} />
  )
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...rest }, ref) => (
    <textarea ref={ref} className={cn(baseField, "min-h-[80px] resize-y", className)} {...rest} />
  )
);
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...rest }, ref) => (
    <select ref={ref} className={cn(baseField, "h-9 pr-8", className)} {...rest} />
  )
);
Select.displayName = "Select";

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium text-subtle uppercase tracking-wide">
      {children}
    </label>
  );
}

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  /** Regla incumplida: se muestra bajo el control y lo marca como inválido. */
  error?: string | null;
}) {
  // La etiqueta se asocia al control (lectores de pantalla y clic en la etiqueta).
  const auto = useId();
  const child = isValidElement(children)
    ? (children as ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>)
    : null;
  const id = child?.props.id ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const control = child
    ? cloneElement(child, {
        id,
        "aria-describedby": child.props["aria-describedby"] ?? errorId ?? hintId,
        ...(error ? { "aria-invalid": true } : {}),
      })
    : children;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={child ? id : undefined}>{label}</Label>
      {control}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-xs text-subtle">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
