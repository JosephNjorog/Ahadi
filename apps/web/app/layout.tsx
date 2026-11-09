import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
  title: { default: "Ahadi — paid when the work is verified", template: "%s · Ahadi" },
  description:
    "Ahadi turns every payment for work into a promise: terms agreed in advance, funds secured through PayPal, money released only when the work is verified.",
  applicationName: "Ahadi",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1411" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
