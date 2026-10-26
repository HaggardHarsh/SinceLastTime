"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  ChevronRight,
  Compass,
  House,
  LogOut,
  MessageCircle,
  Settings,
  SlidersHorizontal,
  Users,
  Video,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAction, useFeedback, useSession } from "./providers";
import { Avatar, Brand, Dialog, ErrorState, LoadingState } from "./ui";
import type { CommunityInfo } from "@/shared/types";

export function AppShell({
  children,
  community,
  role,
  active = "board",
}: {
  children: React.ReactNode;
  community?: CommunityInfo;
  role?: string;
  active?: string;
}) {
  const session = useSession();
  const { demo } = useFeedback();
  const [accountOpen, setAccountOpen] = useState(false);
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [signinMessage, setSigninMessage] = useState<string | null>(null);
  useEffect(() => {
    const messages: Record<string, string> = {
      canceled: "Twitch sign-in was canceled. You can try again whenever you’re ready.",
      expired: "Your sign-in link expired. Connect with Twitch again to continue.",
      unavailable: demo
        ? "Live Twitch sign-in is unavailable. You can explore the demo below."
        : "Twitch sign-in is temporarily unavailable. Please try again shortly.",
      unconfigured: demo
        ? "Live Twitch sign-in hasn’t been connected for this preview. Try a demo below."
        : "Twitch sign-in hasn’t been connected yet.",
    };
    setSigninMessage(
      messages[new URLSearchParams(window.location.search).get("signin") ?? ""] ?? null,
    );
  }, [pathname, demo]);
  const user = session.data?.user;
  const { run, pending } = useAction();
  const communities = useQuery({
    queryKey: ["communities"],
    queryFn: () => api<{ communities: (CommunityInfo & { role: string })[] }>("communities"),
    enabled: Boolean(user),
  });
  const staff = role === "OWNER" || role === "MODERATOR";
  const tabs = community
    ? [
        {
          label: "Community board",
          icon: MessageCircle,
          path: `/c/${community.slug}`,
          key: "board",
        },
        ...(staff
          ? [
              {
                label: "Conversation studio",
                icon: Video,
                path: `/c/${community.slug}/studio`,
                key: "studio",
              },
              {
                label: "Moderation",
                icon: SlidersHorizontal,
                path: `/c/${community.slug}/moderation`,
                key: "moderation",
              },
            ]
          : []),
        ...(role === "OWNER"
          ? [
              {
                label: "Before you go live",
                icon: Compass,
                path: `/c/${community.slug}/briefing`,
                key: "briefing",
              },
            ]
          : []),
        ...(role === "OWNER"
          ? [
              {
                label: "Settings",
                icon: Settings,
                path: `/c/${community.slug}/settings`,
                key: "settings",
              },
            ]
          : []),
      ]
    : [];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <p className="brand-caption">A little more connected.</p>
        <div className="nav-label">YOUR SPACE</div>
        <Link
          className={`nav-link ${pathname === "/communities" ? "selected" : ""}`}
          href="/communities"
        >
          <House size={18} />
          My communities
        </Link>
        <Link
          className={`nav-link ${pathname === "/notifications" ? "selected" : ""}`}
          href="/notifications"
        >
          <Bell size={18} />
          Your catch-ups
        </Link>
        <Link
          className={`nav-link ${pathname === "/account/updates" ? "selected" : ""}`}
          href="/account/updates"
        >
          <MessageCircle size={18} /> Your updates
        </Link>
        <div className="nav-label community-nav-label">YOUR COMMUNITIES</div>
        {communities.data?.communities.map((c) => (
          <Link
            className={`community-nav ${community?.id === c.id ? "selected" : ""}`}
            key={c.id}
            href={`/c/${c.slug}`}
          >
            <Avatar name={c.displayName} url={c.avatarUrl} size="sm" />
            <span>{c.displayName}</span>
            {community?.id === c.id && <span className="small-dot" />}
          </Link>
        ))}
        {community && (
          <div className="community-subnav">
            {tabs.map((tab) => (
              <Link
                className={`nav-link ${active === tab.key ? "selected" : ""}`}
                key={tab.key}
                href={tab.path}
              >
                <tab.icon size={17} />
                {tab.label}
              </Link>
            ))}
          </div>
        )}
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Compass size={23} strokeWidth={1.3} />
            <p>
              Big community.
              <br />
              <strong>Little moments.</strong>
            </p>
            <span>The best conversations have a next chapter.</span>
          </div>
          {user && (
            <div className="account-row">
              <Avatar name={user.displayName} url={user.avatarUrl} size="sm" />
              <span>
                <strong>{user.displayName}</strong>
                <small>Your little corner</small>
              </span>
              <button
                className="icon-button"
                aria-label="Sign out"
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    await api("auth/logout", { method: "POST", body: {} });
                    queryClient.clear();
                    window.location.assign("/");
                  })
                }
              >
                <LogOut size={16} />
              </button>
            </div>
          )}
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand compact />
          </div>
          <span className="breadcrumb">
            Your space <ChevronRight size={13} />
            <strong>{community?.displayName ?? "Welcome back"}</strong>
          </span>
          <div className="topbar-right">
            <span className="connection-label">
              <span />
              Made for your people
            </span>
            <Link className="icon-button" aria-label="Your catch-ups" href="/notifications">
              <Bell size={18} />
            </Link>
            {user && (
              <button
                className="icon-button"
                aria-label="Account menu"
                onClick={() => setAccountOpen(true)}
              >
                <Avatar name={user.displayName} url={user.avatarUrl} size="sm" />
              </button>
            )}
          </div>
        </header>
        <nav className="mobile-nav">
          <Link href="/communities">
            <Users size={15} />
            Communities
          </Link>
          {tabs.map((tab) => (
            <Link key={tab.key} href={tab.path} className={active === tab.key ? "selected" : ""}>
              <tab.icon size={15} />
              {tab.label}
            </Link>
          ))}
        </nav>
        {session.isPending ? (
          <div className="page-content">
            <LoadingState />
          </div>
        ) : session.error ? (
          <div className="page-content">
            <ErrorState message={session.error.message} retry={() => void session.refetch()} />
          </div>
        ) : !user ? (
          <main className="signin-state">
            {signinMessage && (
              <p className="notice" role="status">
                {signinMessage}
              </p>
            )}
            <span className="eyebrow">YOUR PEOPLE ARE HERE</span>
            <h1>{community ? `Join ${community.displayName}.` : "Pick up the conversation."}</h1>
            <p>
              {demo ? (
                "Explore a sample community as a viewer or streamer."
              ) : (
                <>
                  Sign in with Twitch to see what’s new in{" "}
                  {community ? "this community" : "your community"}.
                </>
              )}
            </p>
            {demo && (
              <div className="signin-demo-actions">
                <button
                  className="button button-primary"
                  disabled={pending}
                  onClick={() =>
                    void run(async () => {
                      await api("auth/demo", { method: "POST", body: { login: "maya" } });
                      queryClient.clear();
                      window.location.assign("/c/luna");
                    })
                  }
                >
                  Try viewer demo
                </button>
                <button
                  className="button button-secondary"
                  disabled={pending}
                  onClick={() =>
                    void run(async () => {
                      await api("auth/demo", { method: "POST", body: { login: "luna" } });
                      queryClient.clear();
                      window.location.assign("/c/luna/briefing");
                    })
                  }
                >
                  Try streamer demo
                </button>
              </div>
            )}
            <a
              className={demo ? "text-button" : "button button-primary"}
              href={`/api/auth/twitch?returnTo=${encodeURIComponent(pathname)}`}
            >
              {demo ? "Connect a real Twitch account" : "Connect with Twitch"}
            </a>
            <p className="fine-print">
              {demo
                ? "Demo profiles use sample data. Twitch sign-in isn’t needed to explore."
                : "Community boards are open to verified followers."}
            </p>
          </main>
        ) : (
          children
        )}
      </div>
      <Dialog open={accountOpen} title="Your account" onClose={() => setAccountOpen(false)}>
        <div className="dialog-form">
          <p>
            Signed in as <strong>{user?.displayName}</strong>
          </p>
          <Link
            className="button button-secondary"
            href="/account/updates"
            onClick={() => setAccountOpen(false)}
          >
            Your updates
          </Link>
          <Link
            className="button button-secondary"
            href="/communities"
            onClick={() => setAccountOpen(false)}
          >
            My communities
          </Link>
          <button
            className="button button-secondary"
            disabled={pending}
            onClick={() =>
              void run(async () => {
                await api("auth/logout", { method: "POST", body: {} });
                queryClient.clear();
                window.location.assign("/");
              })
            }
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </Dialog>
    </div>
  );
}
