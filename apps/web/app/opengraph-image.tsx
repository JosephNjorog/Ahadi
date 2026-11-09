import { ImageResponse } from "next/og";

export const alt = "Ahadi — pay for work only when it's done";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social share card: the Ahadi mark, the promise, and the one-line pitch. */
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: "#0a0a0a",
        color: "#ededed",
        fontFamily: "sans-serif",
        backgroundImage:
          "linear-gradient(to right, #1a1a1a 1px, transparent 1px), linear-gradient(to bottom, #1a1a1a 1px, transparent 1px)",
        backgroundSize: "64px 64px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <svg width="64" height="64" viewBox="0 0 32 32" fill="none">
          <circle
            cx="16"
            cy="16"
            r="11"
            stroke="#ededed"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="58.06 11.06"
            transform="rotate(-9 16 16)"
          />
          <circle cx="16" cy="16" r="4.25" fill="#ededed" />
        </svg>
        <span style={{ fontSize: 48, fontWeight: 700, letterSpacing: -2 }}>ahadi</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 84, fontWeight: 700, letterSpacing: -4, lineHeight: 1.02 }}>
          Pay for work only when it&apos;s done.
        </span>
        <span style={{ marginTop: 28, fontSize: 30, color: "#a1a1a1", lineHeight: 1.4 }}>
          Funds held with PayPal. Work verified against signed terms. Exactly the earned share released.
        </span>
      </div>
    </div>,
    size,
  );
}
