import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SinceLastTime — A little more connected", template: "%s · SinceLastTime" },
  description: "A place for your Twitch community to share life's little updates, and pick up the conversation next time.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
