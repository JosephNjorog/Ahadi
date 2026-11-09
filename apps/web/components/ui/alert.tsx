import type { ReactNode } from "react";
import type { Tone } from "@/lib/status";
import { cn } from "./cn";

const tones: Record<Tone, string> = {
  neutral: "border-line bg-canvas text-ink",
  brand: "border-brand-100 bg-brand-50 text-brand-900 dark:text-ink",
  warn: "border-warn-600/25 bg-warn-50 text-ink",
  danger: "border-danger-600/25 bg-danger-50 text-ink",
  info: "border-info-600/25 bg-info-50 text-ink",
};

export function Alert({ tone = "info", title, children, className, action }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex flex-wrap items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm", tones[tone], className)}>
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title ? "mt-0.5" : "", "text-ink-muted")}>{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
