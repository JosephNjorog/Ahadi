import type { ReactNode } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-dvh">
      <AppHeader user={user} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
