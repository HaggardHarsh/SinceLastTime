"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CommunityInfo } from "@/shared/types";
import { useSession } from "./providers";

export function useBoard(slug: string) {
  const session = useSession();
  const lookup = useQuery({ queryKey: ["lookup", slug, session.data?.user?.id], queryFn: () => api<{ community: CommunityInfo; membership: { state: string; role: string } | null }>(`communities/lookup/${slug}`), enabled: !session.isPending });
  const community = lookup.data?.community;
  const joined = Boolean(session.data?.user && lookup.data?.membership?.state === "ACTIVE");
  const details = useQuery({ queryKey: ["community", community?.id, "details"], queryFn: () => api<{ community: CommunityInfo; membership: { role: string; currentEntryId: string | null }; memberCount: number; statusCount: number }>(`communities/${community!.id}`), enabled: Boolean(community && joined), refetchInterval: 10_000 });
  return { session, lookup, community, joined, details, role: details.data?.membership.role ?? lookup.data?.membership?.role };
}
