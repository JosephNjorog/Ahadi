"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/components/ui/cn";

type N = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<N[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const unread = items.filter((n) => !n.readAt).length;

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ notifications: N[] }>("/api/notifications")
        .then((r) => alive && setItems(r.notifications))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 30_000);
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("click", close);
    };
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        className="relative flex size-9 items-center justify-center rounded-md text-ink-muted hover:bg-canvas hover:text-ink"
        onClick={() => {
          setOpen(!open);
          if (!open && unread)
            void api("/api/notifications", { body: {} }).then(() =>
              setItems((xs) => xs.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() }))),
            );
        }}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path
            d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread ? (
          <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-semibold text-white">
            {unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          <p className="border-b border-line px-4 py-2 text-sm font-semibold">Notifications</p>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">You're all caught up.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.link ?? "/dashboard"}
                    onClick={() => setOpen(false)}
                    className={cn("block px-4 py-3 hover:bg-canvas", !n.readAt && "bg-brand-50/50")}
                  >
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{n.body}</p>
                    <p className="mt-1 text-[11px] text-ink-subtle">{formatDateTime(n.createdAt)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
