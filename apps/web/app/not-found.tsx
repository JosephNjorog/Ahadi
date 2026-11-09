import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-semibold text-brand-600">404</p>
      <h1 className="mt-2 text-2xl font-semibold">We couldn't find that</h1>
      <p className="mt-2 max-w-sm text-ink-muted">It may not exist, or you may not be a party to it.</p>
      <ButtonLink href="/dashboard" className="mt-6">
        Back to your promises
      </ButtonLink>
    </div>
  );
}
