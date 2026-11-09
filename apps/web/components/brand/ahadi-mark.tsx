import type { SVGProps } from "react";

/**
 * The Ahadi mark: an open ring (the payment held in trust) and a dot (the
 * verified work) settling inside it. Drawn on a 32-unit grid with currentColor,
 * so it inherits text colour and works on any background.
 *
 * `animated` plays the intro once: the ring draws clockwise, then the dot drops
 * into the centre. Motion is skipped for people who prefer reduced motion.
 */
export function AhadiMark({
  animated = false,
  className,
  title,
  ...props
}: SVGProps<SVGSVGElement> & { animated?: boolean; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={(animated ? "ahadi-mark-anim " : "") + (className ?? "")}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <circle
        className="ahadi-ring"
        cx="16"
        cy="16"
        r="11"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="84 16"
        transform="rotate(-9 16 16)"
      />
      <circle className="ahadi-dot" cx="16" cy="16" r="4.25" fill="currentColor" />
    </svg>
  );
}

/** Mark + lowercase wordmark, the default lock-up. */
export function AhadiLogo({
  animated = false,
  className,
  markClassName = "size-6",
}: {
  animated?: boolean;
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={"inline-flex items-center gap-2 " + (className ?? "")}>
      <AhadiMark animated={animated} className={markClassName} />
      <span className="font-semibold tracking-[-0.04em]">ahadi</span>
    </span>
  );
}
