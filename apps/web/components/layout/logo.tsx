import Link from "next/link";
import { AhadiMark } from "@/components/brand/ahadi-mark";

/** App-wide logo lock-up: the Ahadi mark plus the lowercase wordmark. */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 text-ink" aria-label="Ahadi home">
      <AhadiMark className="size-6" />
      <span className="text-lg font-semibold tracking-[-0.04em]">ahadi</span>
    </Link>
  );
}
