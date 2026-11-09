"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AhadiMark } from "@/components/brand/ahadi-mark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { IconMenu, IconPlus, IconSearch } from "@/components/ui/icons";

/** Search promises from anywhere: submits to /promises?q=…, ⌘K / Ctrl+K focuses it. */
function SearchBox() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(path === "/promises" ? (params.get("q") ?? "") : "");
  const [mac, setMac] = useState(true);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      role="search"
      className="relative w-full max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const next = new URLSearchParams(path === "/promises" ? params.toString() : "");
        if (q.trim()) next.set("q", q.trim());
        else next.delete("q");
        router.push(`/promises${next.toString() ? `?${next}` : ""}`);
      }}
    >
      <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        type="search"
        placeholder="Search promises, people, states…"
        aria-label="Search promises"
        className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-14 text-[14px] outline-none placeholder:text-ink-subtle focus:border-ink focus:ring-2 focus:ring-ink/10"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-raised px-1.5 font-[family-name:var(--font-geist-mono)] text-[10.5px] text-ink-subtle sm:block">
        {mac ? "⌘K" : "Ctrl K"}
      </kbd>
    </form>
  );
}

export function Topbar({ right }: { right: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("ahadi:open-nav"))}
          aria-label="Open navigation"
          className="inline-flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-raised hover:text-ink lg:hidden"
        >
          <IconMenu className="size-5" />
        </button>
        <Link href="/dashboard" className="flex items-center gap-1.5 lg:hidden" aria-label="Ahadi home">
          <AhadiMark className="size-5" />
          <span className="hidden text-[16px] font-semibold tracking-[-0.045em] sm:inline">ahadi</span>
        </Link>
        <div className="hidden flex-1 sm:block">
          <SearchBox />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {right}
          <ThemeToggle />
          <Link
            href="/promises/new"
            className="ml-1 hidden h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13.5px] font-medium text-accent-fg shadow-sm hover:bg-accent-hover md:inline-flex"
          >
            <IconPlus className="size-4" /> New promise
          </Link>
        </div>
      </div>
      <div className="border-t border-line px-4 py-2 sm:hidden">
        <SearchBox />
      </div>
    </header>
  );
}
