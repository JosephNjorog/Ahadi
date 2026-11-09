import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getEnv } from "@ahadi/core/env";
import { Logo } from "@/components/layout/logo";
import { Card, CardBody } from "@/components/ui";
import { currentUser } from "@/lib/auth";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  if (await currentUser()) redirect(next && next.startsWith("/") ? next : "/dashboard");
  const env = getEnv();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Logo />
      <Card className="mt-8 w-full max-w-sm">
        <CardBody className="py-6">
          <h1 className="text-xl font-semibold">Sign in to Ahadi</h1>
          <p className="mt-1 text-sm text-ink-muted">We'll email you a one-time link. No password needed.</p>
          <SignInForm next={next ?? "/dashboard"} demoMode={env.DEMO_MODE} initialError={error === "link" ? "That sign-in link is invalid or has expired. Request a new one." : null} />
        </CardBody>
      </Card>
    </div>
  );
}
