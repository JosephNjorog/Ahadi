import type { ReactNode } from "react";
import type { Tone } from "@/lib/status";
import { cn } from "./cn";

const tones: Record<Tone, string> = {
  neutral: "bg-canvas text-ink-muted border-line",
  brand: "bg-brand-50 text-brand-700 border-brand-100 dark:text-brand-500",
  warn: "bg-warn-50 text-warn-600 border-warn-600/20",
  danger: "bg-danger-50 text-danger-600 border-danger-600/20",
  info: "bg-info-50 text-info-600 border-info-600/20",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
