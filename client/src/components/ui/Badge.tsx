import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  style,
  color,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { color?: string }) {
  const inline = color
    ? { backgroundColor: `${color}22`, color, border: `1px solid ${color}55`, ...style }
    : style;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
        !color && "bg-muted text-text",
        className
      )}
      style={inline}
      {...rest}
    />
  );
}
