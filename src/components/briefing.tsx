"use client";

import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { BookOpen, Check, CornerDownRight, RefreshCw } from "lucide-react";
import { api, timeAgo } from "@/lib/api";
import type { EntryCard } from "@/shared/types";
import { useBoard } from "./use-board";
import { useAction } from "./providers";
import { AppShell } from "./shell";
import { Avatar, Dialog, EmptyState, ErrorState, LoadingState } from "./ui";

type BriefItem = {
  entry: EntryCard;
  previous: { body: string; createdAt: string } | null;
  lastReply: { body: string; displayName: string; createdAt: string } | null;
  lastContactAt: string | null;
  reason: string;
  broadcastEligible: boolean;
};
type BriefPage = {
  items: BriefItem[];
  totals: { count: number; ready: number };
  segment: { id: string; state: string; queue: { entryId: string; entryVersion: number }[] } | null;
  generatedAt: string;
  nextCursor: string | null;
};
const reasons: Record<string, string> = {
  FOLLOW_UP: "A follow-up has arrived",
  NEW_CHAPTER: "A story has a new chapter",
  FIRST_TIME: "A new voice to get to know",
  WAITING: "Time to catch up again",
};

export function Briefing({ slug }: { slug: string }) {
  const board = useBoard(slug);
  const community = board.community;
  const owner = board.role === "OWNER";
  const query = useInfiniteQuery({
    queryKey: ["community", community?.id, "briefing", board.session.data?.user?.id],
    enabled: Boolean(community && board.joined && owner),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api<BriefPage>(
        `communities/${community!.id}/briefing${pageParam ? `?cursor=${pageParam}` : ""}`,
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: 10_000,
  });
  const { run, pending } = useAction();
  const [entry, setEntry] = useState<EntryCard | null>(null);
  const [mode, setMode] = useState<"next" | "reply" | "followup" | null>(null);
  const [reply, setReply] = useState("");
  const [days, setDays] = useState(3);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const segment = query.data?.pages[0].segment;
  return (
    <AppShell community={community} role={board.role} active="briefing">
      <main className="page-content narrow-content briefing-page">
        <div className="page-heading">
          <div>
            <span className="eyebrow">
              <BookOpen size={13} /> START WITH THEIR STORY
            </span>
            <h1>Before you go live.</h1>
            <p>A few real updates. The context you remember. A little time for your people.</p>
          </div>
          <button
            className="button button-secondary"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        {board.lookup.error || board.details.error || query.error ? (
          <ErrorState
            message={(board.lookup.error ?? board.details.error ?? query.error)!.message}
            retry={() => void query.refetch()}
          />
        ) : !community || !board.role ? (
          <LoadingState />
        ) : !owner ? (
          <EmptyState title="A briefing for the streamer">
            Only the streamer can access this briefing and private acknowledgement history.
          </EmptyState>
        ) : query.isPending ? (
          <LoadingState />
        ) : (
          <>
            <div className="briefing-intro">
              <p>
                <strong>{query.data?.pages[0].totals.count ?? 0}</strong> updates waiting for your
                attention · <strong>{query.data?.pages[0].totals.ready ?? 0}</strong> ready
                follow-ups
              </p>
              <p className="fine-print">
                Reading this page sends no receipt. Acknowledge deliberately when you’ve read an
                update. Written replies are visible to the community.
              </p>
            </div>
            {!items.length ? (
              <EmptyState title="A little more caught up">
                There are no current updates waiting for acknowledgement. You can still prepare an
                on-stream conversation.
                <br />
                <Link className="text-button" href={`/c/${slug}/studio`}>
                  Open the conversation studio ↗
                </Link>
              </EmptyState>
            ) : (
              <div className="briefing-list">
                {items.map((item) => (
                  <article className="status-card briefing-card" key={item.entry.id}>
                    <div className="status-heading">
                      <Link
                        className="person-link"
                        href={`/c/${slug}/members/${item.entry.author.id}`}
                      >
                        <Avatar
                          name={item.entry.author.displayName}
                          url={item.entry.author.avatarUrl}
                        />
                        <span>
                          <strong>{item.entry.author.displayName}</strong>
                          <small>{reasons[item.reason]}</small>
                        </span>
                      </Link>
                      <span className="private-label">
                        {item.entry.allowOnStream
                          ? "Broadcast permission granted"
                          : "Community only"}
                      </span>
                    </div>
                    {item.previous && (
                      <div className="briefing-context">
                        <span className="eyebrow">
                          LAST TIME · {timeAgo(item.previous.createdAt)}
                        </span>
                        <p>{item.previous.body}</p>
                      </div>
                    )}
                    {item.lastReply && (
                      <div className="streamer-reply">
                        <CornerDownRight size={15} />
                        <p>
                          <strong>Your last public reply:</strong> {item.lastReply.body}
                        </p>
                      </div>
                    )}
                    <div className="briefing-current">
                      <span className="eyebrow">
                        {item.previous ? "WHAT HAPPENED NEXT" : "THEIR UPDATE"} ·{" "}
                        {timeAgo(item.entry.createdAt)}
                      </span>
                      <p>
                        {item.entry.emoji} {item.entry.body}
                      </p>
                    </div>
                    <p className="fine-print">
                      {item.lastContactAt
                        ? `Last acknowledged or discussed ${timeAgo(item.lastContactAt)}.`
                        : "No previous acknowledgement or discussion recorded."}
                    </p>
                    <div className="attention-actions">
                      <button
                        className="button button-primary"
                        disabled={pending}
                        onClick={() =>
                          void run(async () => {
                            await api(
                              `communities/${community.id}/statuses/${item.entry.id}/acknowledgement`,
                              { method: "PUT", body: { expectedVersion: item.entry.version } },
                            );
                            setEntry(item.entry);
                            setMode("next");
                          }, "Acknowledgement sent to this viewer.")
                        }
                      >
                        <Check size={14} /> Acknowledge
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          setEntry(item.entry);
                          setReply(item.entry.reply?.body ?? "");
                          setMode("reply");
                        }}
                      >
                        Reply to the community
                      </button>
                      <Link
                        className="text-button"
                        href={`/c/${slug}/members/${item.entry.author.id}`}
                      >
                        Read the full story ↗
                      </Link>
                      {item.broadcastEligible &&
                        segment?.state === "DRAFT" &&
                        segment.queue.length < 5 &&
                        !segment.queue.some((queued) => queued.entryId === item.entry.id) && (
                          <button
                            className="text-button"
                            disabled={pending}
                            onClick={() =>
                              void run(
                                () =>
                                  api(`communities/${community.id}/segments/${segment.id}/queue`, {
                                    method: "PUT",
                                    body: {
                                      entries: [
                                        ...segment.queue.map((queued) => ({
                                          id: queued.entryId,
                                          version: queued.entryVersion,
                                        })),
                                        { id: item.entry.id, version: item.entry.version },
                                      ],
                                    },
                                  }),
                                "Added to your draft lineup. Review is still required.",
                              )
                            }
                          >
                            Add to draft lineup
                          </button>
                        )}
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
                More people to catch up with
              </button>
            )}
          </>
        )}
        <Dialog
          open={Boolean(mode && entry)}
          title={
            mode === "reply"
              ? "Reply to the community"
              : mode === "followup"
                ? "Invite an update"
                : "A little more connected"
          }
          onClose={() => setMode(null)}
        >
          {mode === "next" && entry && (
            <div className="dialog-form">
              <p>
                {entry.author.displayName} will see that you read this update. This receipt is
                private to you and them.
              </p>
              <button
                className="button button-secondary"
                onClick={() => {
                  setReply(entry.reply?.body ?? "");
                  setMode("reply");
                }}
              >
                Write a community-visible reply
              </button>
              {entry.allowFollowUp && !entry.followUp && (
                <button className="button button-primary" onClick={() => setMode("followup")}>
                  Invite a follow-up
                </button>
              )}
              <button className="text-button" onClick={() => setMode(null)}>
                Done for now
              </button>
            </div>
          )}
          {mode === "reply" && entry && (
            <form
              className="dialog-form"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await api(`communities/${community!.id}/statuses/${entry.id}/reply`, {
                    method: "PUT",
                    body: { body: reply, expectedVersion: entry.version },
                  });
                  setMode(entry.allowFollowUp && !entry.followUp ? "next" : null);
                }, "Your reply is shared with the community.");
              }}
            >
              <p>
                This written reply is visible to community members and also acknowledges the update.
              </p>
              <label>
                Your reply
                <textarea
                  aria-label="Your public reply"
                  required
                  maxLength={280}
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                />
              </label>
              <button className="button button-primary" disabled={pending}>
                Share your reply
              </button>
            </form>
          )}
          {mode === "followup" && entry && (
            <form
              className="dialog-form"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await api(`communities/${community!.id}/statuses/${entry.id}/follow-up`, {
                    method: "POST",
                    body: { days, expectedVersion: entry.version },
                  });
                  setMode(null);
                }, "Follow-up invitation scheduled.");
              }}
            >
              <p>
                {entry.author.displayName} welcomed one in-app invitation to share what happens
                next.
              </p>
              <label>
                When should we check in?
                <select
                  aria-label="Follow-up timing"
                  value={days}
                  onChange={(event) => setDays(Number(event.target.value))}
                >
                  {[1, 3, 7, 14].map((day) => (
                    <option key={day} value={day}>
                      In {day} {day === 1 ? "day" : "days"}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button button-primary" disabled={pending}>
                Invite an update
              </button>
            </form>
          )}
        </Dialog>
      </main>
    </AppShell>
  );
}
