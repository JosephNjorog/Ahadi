import Link from "next/link";
import { getEnv } from "@ahadi/core/env";
import type { User } from "@ahadi/db";
import { Logo } from "./logo";
import { DemoSwitcher } from "./demo-switcher";
import { SignOutButton } from "./sign-out-button";
import { NavLinks } from "./nav-links";

export function AppHeader({ user }: { user: User }) {
  const env = getEnv();
  const links = [
    { href: "/dashboard", label: "Promises" },
    { href: "/settings", label: "Settings" },
    ...(user.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
  ];
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 px-4 py-2 sm:h-14 sm:flex-nowrap sm:py-0">
        <Logo href="/dashboard" />
        <div className="order-last -mx-1 mt-1 w-full overflow-x-auto sm:order-none sm:mx-0 sm:mt-0 sm:w-auto">
          <NavLinks links={links} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {env.PAYPAL_ENV === "sandbox" ? (
            <span className="hidden rounded-md bg-warn-50 px-2 py-0.5 text-xs font-medium text-warn-600 sm:inline">
              PayPal sandbox
            </span>
          ) : null}
          {env.DEMO_MODE ? <DemoSwitcher currentEmail={user.email} /> : null}
          <Link
            href="/settings"
            className="hidden max-w-40 truncate text-sm text-ink-muted hover:text-ink md:block"
            title={user.email}
          >
            {user.displayName}
          </Link>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
