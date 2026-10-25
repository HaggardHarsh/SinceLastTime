"use client";

import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowUpRight, CornerDownRight, Heart, MessageCircle, Search, Sparkles, Users } from "lucide-react";
import { api } from "@/lib/api";
import type { CommunityInfo, EntryCard } from "@/shared/types";
import { AppShell } from "./shell";
import { useBoard } from "./use-board";
import { Composer } from "./composer";
import { StatusCard } from "./status-card";
import { Avatar, EmptyState, ErrorState, LoadingState } from "./ui";
import { useAction } from "./providers";

export function JoinPanel({ community, suspended = false }: { community: CommunityInfo; suspended?: boolean }) {
  const { run, pending } = useAction();
  return <div className="join-panel"><Avatar name={community.displayName} url={community.avatarUrl} size="lg" /><span className="eyebrow">YOUR PEOPLE, YOUR LITTLE SPACE</span><h1>{community.displayName}</h1><p>{suspended ? "Your access to this board is paused. Contact the community team if you have questions." : community.description}</p>{!suspended && <><button className="button button-primary" disabled={pending} onClick={() => void run(() => api(`communities/${community.id}/join`, { method: "POST", body: {} }), "Welcome in. Make yourself at home.")}>{pending ? "Checking your follow…" : "Join this community"}<ArrowUpRight size={16} /></button><p className="fine-print">For followers of <a href={`https://twitch.tv/${community.slug}`} target="_blank" rel="noreferrer">{community.slug} on Twitch ↗</a>. Follow there, then join here.</p></>}</div>;
}

export function Board({ slug }: { slug: string }) {
  const board = useBoard(slug);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const community = board.community;
  const feed = useInfiniteQuery({ queryKey: ["community", community?.id, "feed", category], initialPageParam: null as string | null, queryFn: ({ pageParam }) => {
    const params = new URLSearchParams(); if (category) params.set("category", category); if (pageParam) params.set("cursor", pageParam);
    return api<{ entries: EntryCard[]; nextCursor: string | null }>(`communities/${community!.id}/statuses?${params}`);
  }, getNextPageParam: (last) => last.nextCursor, enabled: Boolean(community && board.joined), refetchInterval: 10_000 });
  const entries = feed.data?.pages.flatMap((page) => page.entries).filter((entry) => `${entry.body} ${entry.author.displayName}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const user = board.session.data?.user;
  return <AppShell community={community} role={board.role}>
    <main className="page-content">{board.lookup.error ? <ErrorState message={board.lookup.error.message} retry={() => void board.lookup.refetch()} /> : !community ? <LoadingState /> : !board.joined ? <JoinPanel community={community} suspended={board.lookup.data?.membership?.state === "SUSPENDED"} /> : board.details.error || feed.error ? <ErrorState message={(board.details.error ?? feed.error)!.message} retry={() => { void board.details.refetch(); void feed.refetch(); }} /> : <>
      <div className="page-heading"><div><span className="eyebrow"><span className="small-dot" /> A LITTLE SPACE FOR YOUR PEOPLE</span><h1>Hey, {user?.displayName}. <span className="wave">✺</span></h1><p>New chapters. Small victories. All the things since last time.</p></div><span className="date-pill">{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}<span>✦</span>Good to be here.</span></div>
      <div className="board-layout"><section className="board-main" aria-label="Community updates"><Composer communityId={community.id} />
        <div className="feed-heading"><h2>The community board <span>{board.details.data?.statusCount ?? ""}</span></h2><span className="feed-caption">Little windows into each other’s worlds.</span></div>
        <div className="feed-toolbar"><div className="filter-tabs">{[["", "All updates"], ["Small win", "Little wins"], ["Making something", "Making things"], ["Question", "Questions"]].map(([value, label]) => <button key={value} className={category === value ? "active" : ""} onClick={() => setCategory(value)}>{label}</button>)}</div><label className="feed-search"><Search size={15} /><input aria-label="Search updates" placeholder="Find a little something" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
        {feed.isPending ? <LoadingState /> : entries.length ? <div className="status-list">{entries.map((entry) => <StatusCard key={entry.id} entry={entry} slug={slug} role={board.role} />)}</div> : <EmptyState title={search ? "No updates found" : "A new story starts here"}>{search ? "Try another name or a different little detail." : "Share the first little thing that’s happened since last time."}</EmptyState>}
        {feed.hasNextPage && <button className="button button-secondary load-more" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>More little updates</button>}
      </section><aside className="board-aside"><div className="community-about side-card"><div className="room-illustration"><span className="room-window" /><span className="room-plant">🌿</span><span className="room-lamp">✦</span><span className="room-cup">☕</span><span className="room-caption">make yourself at home</span></div><div className="community-about-content"><Avatar name={community.displayName} url={community.avatarUrl} size="lg" /><h2>{community.displayName}</h2><p>{community.description}</p><div className="community-stats"><span><Users size={15} /><strong>{board.details.data?.memberCount ?? "—"}</strong> people</span><span><MessageCircle size={15} /><strong>{board.details.data?.statusCount ?? "—"}</strong> updates</span></div><a href={`https://twitch.tv/${slug}`} target="_blank" rel="noreferrer" className="button button-secondary">Visit the stream<ArrowUpRight size={15} /></a></div></div>
      <div className="side-card prompt-card"><span className="eyebrow"><Sparkles size={13} /> A LITTLE PROMPT</span><h3>{community.prompt}</h3><p>It doesn’t have to be a big thing. Sometimes the ordinary bits are the best bits.</p></div>
      <div className="side-card story-note"><CornerDownRight size={23} /><h3>Life keeps moving.</h3><p>So can the conversation. Come back to an old update and tell us what happened next.</p>{user && <Link href={`/c/${slug}/members/${user.id}`}>Your story so far<ArrowUpRight size={14} /></Link>}</div><div className="aside-footer"><Heart size={12} /> A community is made of moments.</div></aside></div>
    </>}</main>
  </AppShell>;
}
