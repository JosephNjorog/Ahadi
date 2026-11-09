import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb, passports } from "@ahadi/db";
import { Badge, ButtonLink, Card, CardBody, CardHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser("/settings");
  const [passport] = await getDb().select().from(passports).where(eq(passports.userId, user.id));
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">Signed in as {user.email}</p>
      </div>
      <Card>
        <CardHeader
          title="Profile and payouts"
          description="Payouts are sent to this PayPal email. In the sandbox, use a sandbox personal account."
        />
        <CardBody>
          <ProfileForm
            initial={{
              displayName: user.displayName,
              paypalEmail: user.paypalEmail ?? "",
              country: user.country ?? "",
              phoneE164: user.phoneE164 ?? "",
              showExactEarnings: passport?.showExactEarnings ?? false,
            }}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Ahadi Passport"
          description="Your public record of verified, paid work, plus a signed source-of-funds statement for banks and PayPal reviews."
        />
        <CardBody className="flex flex-wrap items-center gap-3">
          {user.passportSlug ? (
            <>
              {passport ? <Badge tone="brand">score {passport.score.toFixed(2)}</Badge> : null}
              <ButtonLink href={`/p/${user.passportSlug}`} variant="secondary" size="sm">
                View public passport
              </ButtonLink>
              <a
                href={`/api/passport/${user.passportSlug}/statement.pdf`}
                className="text-sm font-medium text-brand-700 underline"
              >
                Download statement (PDF)
              </a>
              <a
                href={`/api/passport/${user.passportSlug}/statement.json`}
                className="text-sm text-ink-muted underline"
              >
                Signed JSON
              </a>
            </>
          ) : (
            <p className="text-sm text-ink-muted">Your passport appears after your first settled promise.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
