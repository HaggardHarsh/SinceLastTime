"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api, timeAgo } from "@/lib/api";
import type { EntryCard } from "@/shared/types";
import { AppShell } from "./shell";
import { useAction, useSession } from "./providers";
import { Dialog, EmptyState, ErrorState, LoadingState } from "./ui";

type OwnedEntry = EntryCard & {
  community: { id: string; displayName: string; slug: string };
  membershipState: string;
};
type Page = {
  entries: OwnedEntry[];
  communities: { id: string; displayName: string }[];
  nextCursor: string | null;
};
export function OwnedUpdates() {
  const user = useSession().data?.user;
  const [communityId, setCommunityId] = useState("");
  const [deleting, setDeleting] = useState<OwnedEntry | null>(null);
  const { run, pending } = useAction();
  const query = useInfiniteQuery({
    queryKey: ["owned-updates", user?.id, communityId],
    enabled: Boolean(user),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (communityId) params.set("communityId", communityId);
      if (pageParam) params.set("cursor", pageParam);
      return api<Page>(`me/statuses?${params}`, { signal });
    },
    getNextPageParam: (page) => page.nextCursor,
  });
  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];
  return (
    <AppShell>
      <main className="page-content narrow-content">
        <div className="page-heading">
          <div>
            <span className="eyebrow">YOUR WORDS, YOUR CHOICE</span>
            <h1>Your updates.</h1>
            <p>Manage what you’ve shared, including in communities you can no longer access.</p>
          </div>
        </div>
        <label className="account-filter">
          Community{" "}
          <select
            aria-label="Filter your updates by community"
            value={communityId}
            onChange={(event) => setCommunityId(event.target.value)}
          >
            <option value="">All communities</option>
            {query.data?.pages[0].communities.map((community) => (
              <option key={community.id} value={community.id}>
                {community.displayName}
              </option>
            ))}
          </select>
        </label>
        {query.isPending ? (
          <LoadingState />
        ) : query.error ? (
          <ErrorState message={query.error.message} retry={() => void query.refetch()} />
        ) : !entries.length ? (
          <EmptyState title="No retained updates">
            Your shared updates remain manageable here for thirty days.
          </EmptyState>
        ) : (
          <div className="status-list">
            {entries.map((entry) => (
              <article className="status-card" key={entry.id}>
                <div className="feed-heading">
                  <h2>{entry.community.displayName}</h2>
                  <small>{timeAgo(entry.createdAt)}</small>
                </div>
                {entry.visibility === "HIDDEN" && (
                  <p className="notice">
                    Hidden by the community team. You can still delete it or withdraw permission.
                  </p>
                )}
                {entry.membershipState !== "ACTIVE" && (
                  <p className="fine-print">
                    Community access unavailable. Your own content controls remain available.
                  </p>
                )}
                <div className="status-body">
                  <p>{entry.body}</p>
                  <span className="status-emoji">{entry.emoji}</span>
                </div>
                {entry.acknowledgement && (
                  <p className="acknowledgement-receipt">
                    {entry.acknowledgement.streamer.displayName} read this update ·{" "}
                    {timeAgo(entry.acknowledgement.createdAt)}
                  </p>
                )}
                <div className="account-actions">
                  {entry.allowOnStream && (
                    <button
                      className="button button-secondary"
                      disabled={pending}
                      onClick={() =>
                        void run(
                          () =>
                            api(`me/statuses/${entry.id}/preferences`, {
                              method: "PATCH",
                              body: { expectedVersion: entry.version, allowOnStream: false },
                            }),
                          "Broadcast permission withdrawn.",
                        )
                      }
                    >
                      Withdraw broadcast permission
                    </button>
                  )}
                  {entry.allowFollowUp && (
                    <button
                      className="button button-secondary"
                      disabled={pending}
                      onClick={() =>
                        void run(
                          () =>
                            api(`me/statuses/${entry.id}/preferences`, {
                              method: "PATCH",
                              body: { expectedVersion: entry.version, allowFollowUp: false },
                            }),
                          "Follow-up permission withdrawn.",
                        )
                      }
                    >
                      Withdraw follow-up permission
                    </button>
                  )}
                  <button
                    className="text-button danger-text"
                    disabled={pending}
                    onClick={() => setDeleting(entry)}
                  >
                    Delete update
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        {query.hasNextPage && (
          <button
            className="button button-secondary load-more"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            More of your updates
          </button>
        )}
        <p className="fine-print account-footnote">
          Active updates last seven days; retained text lasts thirty days. Removing a post cannot
          remove recordings made elsewhere.
        </p>
        <Dialog
          open={Boolean(deleting)}
          title="Delete your update?"
          onClose={() => setDeleting(null)}
        >
          <div className="dialog-form">
            <p>
              This removes the update, its responses, and pending invitations, and clears it from
              the overlay.
            </p>
            <button
              className="button button-danger"
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  await api(`me/statuses/${deleting!.id}`, { method: "DELETE", body: {} });
                  setDeleting(null);
                }, "Update deleted.")
              }
            >
              Confirm delete
            </button>
          </div>
        </Dialog>
      </main>
    </AppShell>
  );
}
