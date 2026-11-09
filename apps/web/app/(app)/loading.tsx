export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-line" />
      <div className="h-4 w-80 max-w-full animate-pulse rounded bg-line" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-[var(--radius-card)] bg-line" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-[var(--radius-card)] bg-line" />
    </div>
  );
}
