import { Suspense, type ReactNode } from "react";
import { getEnv } from "@ahadi/core/env";
import { DemoSwitcher } from "@/components/layout/demo-switcher";
import { NotificationBell } from "@/components/layout/notification-bell";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { requireUser } from "@/lib/auth";
import { loadSummary } from "@/lib/summary";

export const dynamic = "force-dynamic";

function roleLabel(email: string, isAdmin: boolean) {
  if (isAdmin) return "Ahadi reviewer · admin";
  if (email.startsWith("client@")) return "Demo client";
  if (email.startsWith("worker@")) return "Demo worker";
  return "Member";
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const env = getEnv();
  const isAdmin = user.role === "admin";
  const attention = await loadSummary(user.id)
    .then((s) => s.attention.length)
    .catch(() => 0);

  return (
    <div className="min-h-dvh">
      <Sidebar
        user={{
          displayName: user.displayName,
          email: user.email,
          roleLabel: roleLabel(user.email, isAdmin),
          isAdmin,
        }}
        attention={attention}
        sandbox={env.PAYPAL_ENV === "sandbox"}
      />
      <div className="lg:pl-64">
        <Suspense fallback={<div className="h-16 border-b border-line" />}>
          <Topbar
            right={
              <>
                {env.DEMO_MODE ? <DemoSwitcher currentEmail={user.email} /> : null}
                <NotificationBell />
              </>
            }
          />
        </Suspense>
        <main className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
