"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Bell, Check, CornerDownRight, Heart, Sparkles } from "lucide-react";
import { api, timeAgo } from "@/lib/api";
import type { EntryCard } from "@/shared/types";
import { AppShell } from "./shell";
import { useAction, useSession } from "./providers";
import { Avatar, Dialog, EmptyState, ErrorState, LoadingState } from "./ui";
import { Composer } from "./composer";

type Notice = { id: string; type: string; createdAt: string; readAt: string | null; followUpId: string | null; community: { id: string; slug: string; displayName: string }; entry: EntryCard };
const labels: Record<string, string> = { FOLLOWUP_DUE: "Any update on this?", FOLLOWUP_READY: "A story has a new chapter.", STREAMER_REPLY: "A little note from your streamer.", DISCUSSED: "You caught up on stream." };

export function Notifications() {
  const user = useSession().data?.user;
  const query = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ notifications: Notice[] }>("notifications"), enabled: Boolean(user), refetchInterval: 10_000 });
  const { run, pending } = useAction();
  const [updating, setUpdating] = useState<Notice | null>(null);
  const unread = query.data?.notifications.filter((n) => !n.readAt).length ?? 0;
  return <AppShell><main className="page-content narrow-content"><div className="page-heading"><div><span className="eyebrow"><Bell size={12} /> THE CONVERSATION CONTINUES</span><h1>Your catch-ups.</h1><p>A few little reasons to pick up where you left off.</p></div>{unread > 0 && <button className="button button-secondary" disabled={pending} onClick={() => void run(() => api("notifications", { method: "PATCH", body: { ids: query.data!.notifications.filter((n) => !n.readAt).map((n) => n.id) } }))}><Check size={14} />Mark all read</button>}</div>
    {query.isPending ? <LoadingState /> : query.error ? <ErrorState message={query.error.message} retry={() => void query.refetch()} /> : !query.data?.notifications.length ? <EmptyState title="All caught up"><span>Your next chapter will find you here.</span></EmptyState> : <div className="notification-list">{query.data.notifications.map((notice) => <article key={notice.id} className={`notification-card ${!notice.readAt ? "unread" : ""}`}><span className="notification-icon">{notice.type === "FOLLOWUP_DUE" ? <CornerDownRight size={21} /> : notice.type === "DISCUSSED" ? <Sparkles size={21} /> : <Heart size={21} />}</span><div className="notification-content"><small>{notice.community.displayName}<span>· {timeAgo(notice.createdAt)}</span></small><h2>{labels[notice.type]}</h2><p className="notification-excerpt">{notice.entry.emoji} {notice.entry.body}</p>{notice.type === "STREAMER_REPLY" && notice.entry.reply && <p className="notification-reply">{notice.entry.reply.author.displayName}: {notice.entry.reply.body}</p>}<div className="notification-actions">{notice.type === "FOLLOWUP_DUE" ? <><button className="button button-primary" onClick={() => setUpdating(notice)}>Share what happened<ArrowUpRight size={14} /></button><button className="text-button" disabled={pending} onClick={() => void run(() => api(`follow-ups/${notice.followUpId}/dismiss`, { method: "POST", body: {} }))}>Maybe another time</button></> : <Link className="text-button" href={notice.type === "FOLLOWUP_READY" ? `/c/${notice.community.slug}/studio` : `/c/${notice.community.slug}/members/${notice.entry.author.id}`}>Pick up the story<ArrowUpRight size={14} /></Link>}{!notice.readAt && <button className="icon-button" aria-label="Mark notification read" disabled={pending} onClick={() => void run(() => api("notifications", { method: "PATCH", body: { ids: [notice.id] } }))}><Check size={14} /></button>}</div></div></article>)}</div>}
    <Dialog open={Boolean(updating)} title="And then what happened?" onClose={() => setUpdating(null)}>{updating && <Composer communityId={updating.community.id} storyId={updating.entry.storyId} onDone={() => setUpdating(null)} />}</Dialog>
  </main></AppShell>;
}
