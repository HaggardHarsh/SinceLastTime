"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUp,
  Check,
  Clock3,
  LockKeyhole,
  MoreHorizontal,
  CornerDownRight,
  Radio,
} from "lucide-react";
import { api, timeAgo } from "@/lib/api";
import { REACTIONS, type EntryCard } from "@/shared/types";
import { Avatar, Dialog, ErrorState, LoadingState } from "./ui";
import { Composer } from "./composer";
import { useAction, useSession } from "./providers";

export function StatusCard({
  entry,
  slug,
  role,
  compact = false,
}: {
  entry: EntryCard;
  slug: string;
  role?: string;
  compact?: boolean;
}) {
  const user = useSession().data?.user;
  const own = entry.author.id === user?.id;
  const active = entry.isCurrent && new Date(entry.expiresAt).getTime() > Date.now();
  const [menu, setMenu] = useState(false);
  const [mode, setMode] = useState<
    "story" | "edit" | "update" | "consent" | "report" | "delete" | "reply" | "followup" | null
  >(null);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(3);
  const [reply, setReply] = useState(entry.reply?.body ?? "");
  const { run, pending } = useAction();
  const story = useQuery({
    queryKey: ["community", entry.communityId, "story", entry.storyId],
    queryFn: () =>
      api<{ entries: EntryCard[] }>(`communities/${entry.communityId}/stories/${entry.storyId}`),
    enabled: mode === "story",
  });
  const close = () => setMode(null);
  const title =
    mode === "story"
      ? `${entry.author.displayName}’s story`
      : mode === "edit"
        ? "A little edit"
        : mode === "update"
          ? "And then what happened?"
          : mode === "consent"
            ? "Your sharing preferences"
            : mode === "report"
              ? "Let the community team know"
              : mode === "delete"
                ? "Delete this update?"
                : mode === "followup"
                  ? "Invite a follow-up"
                  : "Reply to the community";
  return (
    <article className={`status-card ${compact ? "status-card-compact" : ""}`}>
      <div className="status-heading">
        <Link href={`/c/${slug}/members/${entry.author.id}`} className="person-link">
          <Avatar name={entry.author.displayName} url={entry.author.avatarUrl} />
          <span>
            <strong>
              {entry.author.displayName}
              {own && <span className="you-label">you</span>}
            </strong>
            <small>
              {timeAgo(entry.createdAt)}
              <span>·</span>
              {entry.category}
            </small>
          </span>
        </Link>
        <div className="status-menu">
          <button
            className="icon-button"
            aria-label={`Options for ${entry.author.displayName}’s update`}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={19} />
          </button>
          {menu && (
            <div className="dropdown-menu">
              {[
                ["story", "Read the story"],
                ...(own
                  ? [
                      ["update", "Add an update"],
                      ...(active && !entry.discussed ? [["edit", "Edit update"]] : []),
                      ["consent", "Sharing preferences"],
                      ["delete", "Delete update"],
                    ]
                  : [["report", "Report to moderators"]]),
                ...(role === "OWNER" && !own ? [["reply", "Leave a reply"]] : []),
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => {
                    setMode(value as typeof mode);
                    setMenu(false);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {entry.hasPrevious && (
        <button className="followup-label" onClick={() => setMode("story")}>
          <CornerDownRight size={14} />A little follow-up
        </button>
      )}
      <div className="status-body">
        <p>{entry.body}</p>
        {entry.emoji && (
          <span className="status-emoji" aria-hidden="true">
            {entry.emoji}
          </span>
        )}
      </div>
      {entry.reply && (
        <div className="streamer-reply">
          <CornerDownRight size={15} />
          <div>
            <strong>
              {entry.reply.author.displayName}
              <span className="streamer-label">streamer</span>
            </strong>
            <p>{entry.reply.body}</p>
          </div>
        </div>
      )}
      {own && entry.acknowledgement && (
        <p className="acknowledgement-receipt">
          {entry.acknowledgement.streamer.displayName} read this update ·{" "}
          {timeAgo(entry.acknowledgement.createdAt)}
          <br />
          <small>Only you and the streamer can see this acknowledgement.</small>
        </p>
      )}
      {role === "OWNER" && !own && (
        <div className="attention-actions">
          {entry.acknowledgement ? (
            <span className="acknowledgement-receipt">
              <Check size={13} /> Acknowledged
            </span>
          ) : (
            <button
              className="text-button"
              disabled={pending}
              onClick={() =>
                void run(
                  () =>
                    api(`communities/${entry.communityId}/statuses/${entry.id}/acknowledgement`, {
                      method: "PUT",
                      body: { expectedVersion: entry.version },
                    }),
                  "Acknowledged. Only this viewer can see your receipt.",
                )
              }
            >
              Acknowledge
            </button>
          )}
          <button className="text-button" onClick={() => setMode("reply")}>
            Reply to the community
          </button>
          {entry.allowFollowUp && (entry.acknowledgement || entry.discussed) && !entry.followUp && (
            <button className="text-button" onClick={() => setMode("followup")}>
              Invite a follow-up
            </button>
          )}
        </div>
      )}
      <div className="status-footer">
        <div className="reaction-group">
          {REACTIONS.map((choice) => (
            <button
              className={`reaction ${entry.myReaction === choice ? "reacted" : ""}`}
              aria-label={`React ${choice} to ${entry.author.displayName}’s update`}
              aria-pressed={entry.myReaction === choice}
              key={choice}
              disabled={pending || !active}
              onClick={() =>
                void run(() =>
                  api(`communities/${entry.communityId}/statuses/${entry.id}/reaction`, {
                    method: entry.myReaction === choice ? "DELETE" : "PUT",
                    body: { choice },
                  }),
                )
              }
            >
              <span>{choice}</span>
              {entry.reactionCounts[choice] ?? 0}
            </button>
          ))}
        </div>
        <div className="status-actions">
          {entry.discussed ? (
            <span className="discussed-label">
              <Check size={13} />
              Caught up
            </span>
          ) : !entry.allowOnStream ? (
            <span
              className="private-label"
              title="Shared with this community. Not available for broadcast."
            >
              <LockKeyhole size={12} />
              Community only
            </span>
          ) : (
            <button
              className={`vote-button ${entry.myVote ? "voted" : ""}`}
              disabled={pending || own || !active}
              aria-pressed={entry.myVote}
              onClick={() =>
                void run(() =>
                  api(`communities/${entry.communityId}/statuses/${entry.id}/vote`, {
                    method: entry.myVote ? "DELETE" : "PUT",
                    body: {},
                  }),
                )
              }
            >
              <ArrowUp size={14} />
              Bring this up<span>{entry.voteCount}</span>
            </button>
          )}
        </div>
      </div>
      <Dialog open={mode !== null} title={title} onClose={close}>
        {(mode === "edit" || mode === "update" || mode === "consent") && (
          <Composer
            communityId={entry.communityId}
            editing={mode === "update" ? undefined : entry}
            storyId={mode === "update" ? entry.storyId : undefined}
            consentOnly={mode === "consent"}
            onDone={close}
          />
        )}
        {mode === "story" && (
          <div className="story-dialog">
            {story.isPending ? (
              <LoadingState />
            ) : story.error ? (
              <ErrorState message={story.error.message} />
            ) : (
              story.data?.entries.map((item, index) => (
                <div className="story-chapter" key={item.id}>
                  <span className="chapter-dot" />
                  <small>
                    {index === 0 ? "THE FIRST CHAPTER" : "WHAT HAPPENED NEXT"}{" "}
                    <span>· {timeAgo(item.createdAt)}</span>
                  </small>
                  <p>
                    {item.emoji} {item.body}
                  </p>
                  {item.reply && (
                    <div className="streamer-reply">
                      <CornerDownRight size={15} />
                      <p>
                        <strong>{item.reply.author.displayName}:</strong> {item.reply.body}
                      </p>
                    </div>
                  )}
                </div>
              ))
            )}
            {own && (
              <button className="button button-primary" onClick={() => setMode("update")}>
                Add an update
                <CornerDownRight size={15} />
              </button>
            )}
          </div>
        )}
        {mode === "report" && (
          <form
            className="dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api(`communities/${entry.communityId}/statuses/${entry.id}/report`, {
                  method: "POST",
                  body: { reason },
                });
                close();
              }, "The community team will review this update.");
            }}
          >
            <p>Your report goes to the streamer and board moderators.</p>
            <label>
              What should they know?
              <textarea
                required
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <button className="button button-primary" disabled={pending}>
              Send report
            </button>
          </form>
        )}
        {mode === "reply" && (
          <form
            className="dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api(`communities/${entry.communityId}/statuses/${entry.id}/reply`, {
                  method: "PUT",
                  body: { body: reply, expectedVersion: entry.version },
                });
                close();
              }, "Your reply is shared.");
            }}
          >
            <p>Your reply is visible to members of this community.</p>
            <label>
              Your reply
              <textarea
                required
                value={reply}
                maxLength={280}
                onChange={(event) => setReply(event.target.value)}
              />
            </label>
            <button className="button button-primary" disabled={pending}>
              Share your reply
            </button>
          </form>
        )}
        {mode === "followup" && (
          <form
            className="dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api(`communities/${entry.communityId}/statuses/${entry.id}/follow-up`, {
                  method: "POST",
                  body: { days, expectedVersion: entry.version },
                });
                close();
              }, "Follow-up invitation scheduled.");
            }}
          >
            <p>This viewer welcomed one in-app invitation to share what happened next.</p>
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
        {mode === "delete" && (
          <div className="dialog-form">
            <p>
              This removes the update, its reactions, and any pending reminder. It will also clear
              it from the live overlay.
            </p>
            <button
              className="button button-danger"
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  await api(`communities/${entry.communityId}/statuses/${entry.id}`, {
                    method: "DELETE",
                    body: {},
                  });
                  close();
                }, "Update deleted.")
              }
            >
              Confirm delete
            </button>
          </div>
        )}
      </Dialog>
    </article>
  );
}
