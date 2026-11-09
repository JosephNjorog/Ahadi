"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import { AhadiMark } from "@/components/brand/ahadi-mark";
import { cn } from "@/components/ui/cn";
import {
  IconBot,
  IconGrid,
  IconHome,
  IconList,
  IconLogout,
  IconPlus,
  IconShield,
  IconStore,
  IconTerminal,
  IconUser,
  IconX,
} from "@/components/ui/icons";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  badge?: number;
  /** Extra paths that should light this item up. */
  match?: (path: string) => boolean;
};

export type SidebarUser = {
  displayName: string;
  email: string;
  roleLabel: string;
  isAdmin: boolean;
};

function initials(name: string) {
  const parts = name
    .replace(/\(.*\)/, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "A";
}

function sections(user: SidebarUser, attention: number): { title: string; items: NavItem[] }[] {
  const out: { title: string; items: NavItem[] }[] = [
    { title: "Overview", items: [{ href: "/dashboard", label: "Home", icon: IconHome }] },
    {
      title: "Promises",
      items: [
        {
          href: "/promises",
          label: "All promises",
          icon: IconList,
          badge: attention || undefined,
          match: (p) => p === "/promises" || (p.startsWith("/promises/") && !p.startsWith("/promises/new")),
        },
        { href: "/promises/new", label: "New promise", icon: IconPlus },
      ],
    },
    {
      title: "Agent economy",
      items: [
        { href: "/marketplace", label: "Marketplace", icon: IconStore },
        { href: "/agents", label: "AI agents", icon: IconBot },
      ],
    },
    { title: "Account", items: [{ href: "/settings", label: "Passport & payouts", icon: IconUser }] },
  ];
  if (user.isAdmin)
    out.push({
      title: "Admin",
      items: [
        {
          href: "/admin",
          label: "Console",
          icon: IconShield,
          match: (p) => p === "/admin" || p.startsWith("/admin/milestones"),
        },
        { href: "/admin/ledger", label: "Ledger grid", icon: IconGrid },
        { href: "/admin/ops", label: "Ops agent", icon: IconTerminal },
      ],
    });
  return out;
}

function NavList({
  user,
  attention,
  onNavigate,
}: {
  user: SidebarUser;
  attention: number;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="space-y-5">
      {sections(user, attention).map((sec) => (
        <div key={sec.title}>
          <p className="px-3 font-[family-name:var(--font-geist-mono)] text-[10.5px] uppercase tracking-[0.1em] text-ink-subtle">
            {sec.title}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {sec.items.map((it) => {
              const active = it.match ? it.match(path) : path === it.href || path.startsWith(`${it.href}/`);
              const I = it.icon;
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors",
                      active
                        ? "bg-surface font-medium text-ink shadow-[var(--shadow-card)] ring-1 ring-line"
                        : "text-ink-muted hover:bg-raised hover:text-ink",
                    )}
                  >
                    {active ? (
                      <span
                        className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r bg-ink"
                        aria-hidden="true"
                      />
                    ) : null}
                    <I className="size-[18px] shrink-0" />
                    <span className="truncate">{it.label}</span>
                    {it.badge ? (
                      <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-danger-600 px-1.5 text-[11px] font-semibold text-white dark:text-canvas">
                        {it.badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarBody({
  user,
  attention,
  sandbox,
  onNavigate,
}: {
  user: SidebarUser;
  attention: number;
  sandbox: boolean;
  onNavigate?: () => void;
}) {
  const [signingOut, setSigningOut] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2 px-5">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2"
          aria-label="Ahadi home"
        >
          <AhadiMark className="size-[22px]" />
          <span className="text-[18px] font-semibold tracking-[-0.045em]">ahadi</span>
        </Link>
      </div>

      <div className="px-3">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5 shadow-[var(--shadow-card)]">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-[12px] font-semibold text-accent-fg">
            {initials(user.displayName)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-medium">{user.displayName}</span>
            <span className="block truncate text-[12px] text-ink-subtle">{user.roleLabel}</span>
          </span>
        </div>
      </div>

      <div className="mt-5 flex-1 overflow-y-auto px-3 pb-4">
        <NavList user={user} attention={attention} onNavigate={onNavigate} />
      </div>

      <div className="shrink-0 space-y-3 border-t border-line p-3">
        {sandbox ? (
          <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
            <p className="flex items-center gap-2 text-[12.5px] font-medium">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-500 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-brand-500" />
              </span>
              PayPal sandbox connected
            </p>
            <p className="mt-0.5 text-[11.5px] text-ink-subtle">No real money moves</p>
          </div>
        ) : null}
        <div className="flex items-center gap-2 px-1">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] text-ink-muted" title={user.email}>
              {user.email}
            </span>
          </span>
          <button
            type="button"
            aria-label="Sign out"
            title="Sign out"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await fetch("/api/auth/sign-out", { method: "POST" });
              window.location.href = "/";
            }}
            className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-raised hover:text-ink disabled:opacity-50"
          >
            <IconLogout className="size-[18px]" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Fixed sidebar on large screens; a slide-in drawer below that, opened from the top bar. */
export function Sidebar({
  user,
  attention,
  sandbox,
}: {
  user: SidebarUser;
  attention: number;
  sandbox: boolean;
}) {
  const [open, setOpen] = useState(false);
  const path = usePathname();

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("ahadi:open-nav", onOpen);
    return () => window.removeEventListener("ahadi:open-nav", onOpen);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-canvas lg:block">
        <SidebarBody user={user} attention={attention} sandbox={sandbox} />
      </aside>

      <div
        className={cn("fixed inset-0 z-40 lg:hidden", open ? "pointer-events-auto" : "pointer-events-none")}
        aria-hidden={!open}
      >
        <div
          className={cn(
            "absolute inset-0 bg-black/40 transition-opacity",
            open ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setOpen(false)}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          className={cn(
            "absolute inset-y-0 left-0 w-[min(18rem,85vw)] border-r border-line bg-canvas shadow-2xl transition-transform duration-200",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="absolute right-3 top-4 inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-raised hover:text-ink"
          >
            <IconX className="size-[18px]" />
          </button>
          <SidebarBody
            user={user}
            attention={attention}
            sandbox={sandbox}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </div>
    </>
  );
}
