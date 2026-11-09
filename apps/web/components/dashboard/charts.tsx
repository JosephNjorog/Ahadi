import { formatMoney } from "@/lib/format";

/** Smooth path through points (monotone-ish cubic between midpoints). */
function smoothPath(pts: [number, number][]) {
  if (pts.length === 0) return "";
  let d = `M${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const cx = (x0 + x1) / 2;
    d += ` C${cx.toFixed(1)} ${y0.toFixed(1)} ${cx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}

function niceMax(v: number) {
  if (v <= 0) return 10_000;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** Tiny trend line for stat cards. Draws a flat baseline when there is no data. */
export function Sparkline({
  values,
  tone = "ink",
  className = "h-12 w-full",
}: {
  values: number[];
  tone?: "ink" | "brand" | "danger";
  className?: string;
}) {
  const w = 240;
  const h = 48;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts: [number, number][] = values.map((v, i) => [
    (i / Math.max(1, values.length - 1)) * w,
    h - 4 - ((v - min) / span) * (h - 10),
  ]);
  const line = smoothPath(pts);
  const color =
    tone === "brand"
      ? "var(--color-brand-500)"
      : tone === "danger"
        ? "var(--color-danger-600)"
        : "var(--color-ink)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={color} opacity={0.08} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Cumulative money over the last N days: secured with PayPal (dotted) vs captured for
 * verified work (solid), with a labelled y-axis and weekly x-axis ticks.
 */
export function MoneyChart({
  start,
  secured,
  captured,
  currency,
  compact = false,
}: {
  start: Date;
  secured: number[];
  captured: number[];
  currency: string;
  /** Narrow variant for phones: fewer ticks, proportionally larger labels. */
  compact?: boolean;
}) {
  const W = compact ? 360 : 760;
  const H = compact ? 220 : 260;
  const padL = compact ? 44 : 56;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const n = Math.max(secured.length, captured.length);
  const top = niceMax(Math.max(...secured, ...captured, 0));
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / top) * (H - padT - padB);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => top * f);
  const capPts = captured.map((v, i) => [x(i), y(v)] as [number, number]);
  const secPts = secured.map((v, i) => [x(i), y(v)] as [number, number]);
  const capLine = smoothPath(capPts);
  const fmtDay = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Nairobi",
  });
  const fillId = compact ? "cap-fill-sm" : "cap-fill";
  const every = compact ? 14 : 7;
  // Weekly ticks plus "today", skipping a weekly tick that would collide with the last one.
  const ticks = Array.from({ length: n }, (_, i) => i).filter(
    (i) => i === n - 1 || (i % every === 0 && n - 1 - i >= every / 2),
  );
  const short = (minor: number) => {
    const v = minor / 100;
    if (v >= 1000) return `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`;
    return `$${v % 1 ? v.toFixed(2) : v}`;
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Secured ${formatMoney(secured.at(-1) ?? 0, currency)} and captured ${formatMoney(captured.at(-1) ?? 0, currency)} over the last ${n} days`}
    >
      <defs>
        <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--color-ink)" stopOpacity="0.14" />
          <stop offset="100%" stopColor="var(--color-ink)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((g) => (
        <g key={g}>
          <line
            x1={padL}
            x2={W - padR}
            y1={y(g)}
            y2={y(g)}
            stroke="var(--color-line)"
            strokeDasharray="3 4"
          />
          <text x={padL - 10} y={y(g) + 4} textAnchor="end" fontSize="11" fill="var(--color-ink-subtle)">
            {short(g)}
          </text>
        </g>
      ))}
      {ticks.map((i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--color-ink-subtle)">
          {fmtDay.format(new Date(start.getTime() + i * 86_400_000))}
        </text>
      ))}
      <path
        d={smoothPath(secPts)}
        fill="none"
        stroke="var(--color-ink-subtle)"
        strokeWidth={1.6}
        strokeDasharray="4 4"
      />
      <path d={`${capLine} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill={`url(#${fillId})`} />
      <path d={capLine} fill="none" stroke="var(--color-ink)" strokeWidth={2} />
      {capPts.length ? (
        <circle
          cx={capPts.at(-1)![0]}
          cy={capPts.at(-1)![1]}
          r={4}
          fill="var(--color-ink)"
          stroke="var(--color-surface)"
          strokeWidth={2}
        />
      ) : null}
    </svg>
  );
}
