import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: { default: "SinceLastTime — A little more connected", template: "%s · SinceLastTime" },
  description:
    "A place for your Twitch community to share life's little updates, and pick up the conversation next time.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const demo = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
  return (
    <html lang="en">
      <body>
        <Providers demo={demo}>{children}</Providers>
      </body>
    </html>
  );
}
