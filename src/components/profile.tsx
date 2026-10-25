"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import type { EntryCard, PublicUser } from "@/shared/types";
import { AppShell } from "./shell";
import { useBoard } from "./use-board";
import { JoinPanel } from "./board";
import { Avatar, EmptyState, ErrorState, LoadingState } from "./ui";
import { StatusCard } from "./status-card";

export function Profile({ slug, userId }: { slug: string; userId: string }) {
  const board = useBoard(slug);
  const community = board.community;
  const profile = useQuery({ queryKey: ["community", community?.id, "profile", userId], queryFn: () => api<{ user: PublicUser; joinedAt: string; role: string; entries: EntryCard[] }>(`communities/${community!.id}/members/${userId}`), enabled: Boolean(community && board.joined), refetchInterval: 10_000 });
  const own = board.session.data?.user?.id === userId;
  return <AppShell community={community} role={board.role}><main className="page-content narrow-content">
    <Link className="back-link" href={`/c/${slug}`}><ArrowLeft size={14} />Back to the board</Link>
    {board.lookup.error ? <ErrorState message={board.lookup.error.message} /> : !community ? <LoadingState /> : !board.joined ? <JoinPanel community={community} /> : board.details.error || profile.error ? <ErrorState message={(board.details.error ?? profile.error)!.message} retry={() => void profile.refetch()} /> : profile.isPending ? <LoadingState /> : profile.data && <>
      <div className="profile-hero"><div className="profile-hero-pattern"><span>✦</span><span>✧</span><span>✺</span></div><Avatar name={profile.data.user.displayName} url={profile.data.user.avatarUrl} size="lg" /><div className="profile-hero-body"><span className="eyebrow"><BookOpen size={12} /> EVERY USERNAME HAS A STORY</span><h1>{own ? "Your story so far." : `${profile.data.user.displayName}’s little chapters.`}</h1><p>Part of {community.displayName} since {new Date(profile.data.joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}.</p><span className="profile-role">{profile.data.role === "OWNER" ? "The person behind the stream" : profile.data.role === "MODERATOR" ? "Community team" : "One of our people"}</span></div></div>
      <div className="feed-heading"><h2>{own ? "The things you’ve shared" : "Life, lately"}</h2><span className="feed-caption">Recent chapters stay here for 30 days.</span></div>
      {profile.data.entries.length ? <div className="status-list">{profile.data.entries.map((entry) => <div className="profile-chapter" key={entry.id}>{entry.isCurrent && new Date(entry.expiresAt).getTime() > Date.now() && <span className="chapter-label"><Sparkles size={12} />CURRENT LITTLE UPDATE</span>}<StatusCard entry={entry} slug={slug} role={board.role} /></div>)}</div> : <EmptyState title="A story waiting to happen">The first little update is all it takes.<br /><Link className="text-button" href={`/c/${slug}`}>Share something on the board ↗</Link></EmptyState>}
    </>}
  </main></AppShell>;
}
