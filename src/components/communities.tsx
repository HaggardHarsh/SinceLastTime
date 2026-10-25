"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Plus, Search, Users } from "lucide-react";
import { api } from "@/lib/api";
import type { CommunityInfo } from "@/shared/types";
import { AppShell } from "./shell";
import { useAction, useSession } from "./providers";
import { Avatar, Dialog, EmptyState, ErrorState, LoadingState } from "./ui";

export function Communities() {
  const user = useSession().data?.user;
  const query = useQuery({ queryKey: ["communities"], queryFn: () => api<{ communities: (CommunityInfo & { role: string })[]; ownsCommunity: boolean }>("communities"), enabled: Boolean(user) });
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const { run, pending } = useAction();
  const router = useRouter();
  return <AppShell><main className="page-content"><div className="page-heading"><div><span className="eyebrow"><Users size={12} /> YOUR LITTLE CORNERS OF THE INTERNET</span><h1>Your people are here.</h1><p>Different communities. A little space for every part of you.</p></div>{query.data && !query.data.ownsCommunity && <button className="button button-primary" onClick={() => { setCreating(true); setName(`${user?.displayName ?? "Our"}’s community`); }}><Plus size={15} />Create your community</button>}</div>
    <form className="community-find" onSubmit={(event) => { event.preventDefault(); let slug = search.trim().replace(/^https?:\/\/(?:www\.)?twitch.tv\//, "").replace(/^.*\/c\//, "").split(/[/?#]/)[0]; if (/^[a-zA-Z0-9_]{1,25}$/.test(slug)) router.push(`/c/${slug.toLowerCase()}`); }}><Search size={18} /><input aria-label="Find a community" placeholder="Find a community by Twitch username or board link…" value={search} onChange={(e) => setSearch(e.target.value)} required /><button className="button button-secondary">Find your people<ArrowUpRight size={14} /></button></form>
    {query.isPending ? <LoadingState /> : query.error ? <ErrorState message={query.error.message} retry={() => void query.refetch()} /> : query.data?.communities.length ? <div className="community-grid">{query.data.communities.map((community) => <Link className="community-tile" key={community.id} href={`/c/${community.slug}`}><div className="tile-art"><span>✦</span><span>✧</span></div><Avatar name={community.displayName} url={community.avatarUrl} size="lg" /><div className="tile-content"><span className="eyebrow">{community.role === "OWNER" ? "YOUR COMMUNITY" : community.role === "MODERATOR" ? "COMMUNITY TEAM" : "ONE OF YOUR LITTLE SPACES"}</span><h2>{community.displayName}</h2><p>{community.description}</p><span className="tile-open">See what’s new<ArrowUpRight size={15} /></span></div></Link>)}</div> : <EmptyState title="Find your first little space">Open a board shared by your streamer, or search for their Twitch username above.</EmptyState>}
    <Dialog open={creating} title="Make a little room for your people" onClose={() => setCreating(false)}><form className="dialog-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { const community = await api<CommunityInfo>("communities", { method: "POST", body: { displayName: name } }); router.push(`/c/${community.slug}`); setCreating(false); }, "Your community has a new home."); }}><p>The board belongs to your Twitch channel. Followers can join, share their updates, and catch up with you.</p><label>What should we call your space?<input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} /></label><button className="button button-primary" disabled={pending}>Create your community<ArrowUpRight size={15} /></button></form></Dialog>
  </main></AppShell>;
}
