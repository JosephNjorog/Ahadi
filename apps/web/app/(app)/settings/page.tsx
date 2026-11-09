import type { Metadata } from "next";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser("/settings");
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">Signed in as {user.email}</p>
      </div>
      <Card>
        <CardHeader title="Profile and payouts" description="Payouts are sent to this PayPal email. In the sandbox, use a sandbox personal account." />
        <CardBody>
          <ProfileForm initial={{ displayName: user.displayName, paypalEmail: user.paypalEmail ?? "", country: user.country ?? "" }} />
        </CardBody>
      </Card>
    </div>
  );
}
