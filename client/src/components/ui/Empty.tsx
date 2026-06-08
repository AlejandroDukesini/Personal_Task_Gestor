import { Inbox, type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

export function Empty({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4">
      <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center text-subtle mb-4">
        <Icon size={26} />
      </div>
      <h3 className="font-medium">{title}</h3>
      {description && <p className="text-sm text-subtle mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
