"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, EyeOff, Monitor, RotateCcw, Save, Search, ShieldCheck, Users } from "lucide-react";
import { api } from "@/lib/api";
import type { CommunityInfo, EntryCard, PublicUser } from "@/shared/types";
import { AppShell } from "./shell";
import { useBoard } from "./use-board";
import { useAction, useSession } from "./providers";
import { Avatar, EmptyState, ErrorState, LoadingState } from "./ui";

type Member = {
  id: string;
  user: PublicUser;
  role: string;
  state: string;
  discussionCount: number;
};
function Members({ communityId, owner }: { communityId: string; owner: boolean }) {
  const session = useSession();
  const members = useQuery({
    queryKey: ["community", communityId, "members"],
    queryFn: () => api<{ members: Member[] }>(`communities/${communityId}/members`),
    refetchInterval: 10_000,
  });
  const [search, setSearch] = useState("");
  const { pending, run } = useAction();
  return (
    <section className="admin-section">
      <div className="admin-section-heading">
        <div>
          <h2>Your community team & people</h2>
          <p>Board roles apply here. Your Twitch channel’s roles are managed on Twitch.</p>
        </div>
        <Users size={22} />
      </div>
      <label className="feed-search member-search">
        <Search size={15} />
        <input
          aria-label="Search members"
          placeholder="Find a community member"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {members.isPending ? (
        <LoadingState />
      ) : members.error ? (
        <ErrorState message={members.error.message} />
      ) : (
        <div className="member-list">
          {members.data?.members
            .filter((member) =>
              member.user.displayName.toLowerCase().includes(search.toLowerCase()),
            )
            .map((member) => (
              <div className="member-row" key={member.id}>
                <Avatar name={member.user.displayName} url={member.user.avatarUrl} size="sm" />
                <div className="member-name">
                  <strong>{member.user.displayName}</strong>
                  <small>
                    {member.state === "ACTIVE"
                      ? "In the community"
                      : member.state === "SUSPENDED"
                        ? "Access paused"
                        : "Needs to rejoin"}
                  </small>
                </div>
                {owner && member.role !== "OWNER" ? (
                  <select
                    aria-label={`Role for ${member.user.displayName}`}
                    value={member.role}
                    disabled={pending || member.state !== "ACTIVE"}
                    onChange={(event) =>
                      void run(
                        () =>
                          api(`communities/${communityId}/members/${member.user.id}`, {
                            method: "PATCH",
                            body: { action: "set-role", role: event.target.value },
                          }),
                        "Community role updated.",
                      )
                    }
                  >
                    <option value="VIEWER">Member</option>
                    <option value="MODERATOR">Moderator</option>
                  </select>
                ) : (
                  <span className="member-role">
                    {member.role === "OWNER"
                      ? "Streamer"
                      : member.role === "MODERATOR"
                        ? "Moderator"
                        : "Member"}
                  </span>
                )}
                {member.role !== "OWNER" &&
                  member.user.id !== session.data?.user?.id &&
                  (owner || member.role !== "MODERATOR") && (
                    <button
                      className={`button ${member.state === "SUSPENDED" ? "button-secondary" : "button-quiet-danger"}`}
                      disabled={pending}
                      onClick={() =>
                        void run(
                          () =>
                            api(`communities/${communityId}/members/${member.user.id}`, {
                              method: "PATCH",
                              body: {
                                action: member.state === "SUSPENDED" ? "reinstate" : "suspend",
                              },
                            }),
                          member.state === "SUSPENDED"
                            ? "Access restored. They can join again after verifying their follow."
                            : "Community access paused.",
                        )
                      }
                    >
                      {member.state === "SUSPENDED" ? "Restore access" : "Pause access"}
                    </button>
                  )}
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

export function SettingsForm({
  community,
  onSaved,
}: {
  community: CommunityInfo;
  onSaved?: () => Promise<unknown>;
}) {
  const [displayName, setDisplayName] = useState(community.displayName);
  const [description, setDescription] = useState(community.description);
  const [prompt, setPrompt] = useState(community.prompt);
  const { run, pending } = useAction();
  return (
    <form
      className="admin-section settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await api(`communities/${community.id}`, {
            method: "PATCH",
            body: { displayName, description, prompt },
          });
          await onSaved?.();
        }, "Your little space is updated.");
      }}
    >
      <div className="admin-section-heading">
        <div>
          <h2>Make it feel like your community</h2>
          <p>A familiar name, a little welcome, and something to talk about.</p>
        </div>
      </div>
      <label>
        Community name
        <input
          required
          minLength={2}
          maxLength={80}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>
      <label>
        A little introduction
        <textarea
          required
          maxLength={300}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </label>
      <label>
        The community prompt
        <input
          required
          maxLength={120}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      <div className="settings-save">
        <span className="fine-print">Followers join at /c/{community.slug}</span>
        <button className="button button-primary" disabled={pending}>
          <Save size={14} />
          Save changes
        </button>
      </div>
    </form>
  );
}

export function Settings({ slug }: { slug: string }) {
  const board = useBoard(slug);
  const community = board.community;
  return (
    <AppShell community={community} role={board.role} active="settings">
      <main className="page-content narrow-content">
        <div className="page-heading">
          <div>
            <span className="eyebrow">YOUR COMMUNITY, YOUR TOUCH</span>
            <h1>A space that feels like you.</h1>
            <p>Set the tone. Make room for your people.</p>
          </div>
        </div>
        {board.lookup.error || board.details.error ? (
          <ErrorState message={(board.lookup.error ?? board.details.error)!.message} />
        ) : !community || !board.role ? (
          <LoadingState />
        ) : board.role !== "OWNER" ? (
          <EmptyState title="The streamer makes this space their own">
            These settings are available to the community owner.
          </EmptyState>
        ) : (
          <div className="admin-stack">
            <section className="admin-section">
              <h2>Welcome your people.</h2>
              <p>Reopen your setup checklist, share your link, and download the Twitch panel.</p>
              <Link className="button button-secondary" href={`/c/${slug}/setup`}>
                Open setup & sharing tools
              </Link>
            </section>
            <SettingsForm key={community.id} community={community} />
            <Members communityId={community.id} owner />
            <section className="admin-section overlay-settings">
              <Monitor size={25} />
              <div>
                <h2>Bring your people onto the stream.</h2>
                <p>Create or rotate the read-only OBS link from the conversation studio.</p>
              </div>
              <Link className="button button-secondary" href={`/c/${slug}/studio`}>
                Open the studio
              </Link>
            </section>
          </div>
        )}
      </main>
    </AppShell>
  );
}

type Reports = { reports: { id: string; reason: string; reporter: string; entry: EntryCard }[] };
export function Moderation({ slug }: { slug: string }) {
  const board = useBoard(slug);
  const community = board.community;
  const staff = board.role === "OWNER" || board.role === "MODERATOR";
  const [tab, setTab] = useState("reports");
  const reports = useQuery({
    queryKey: ["community", community?.id, "reports"],
    queryFn: () => api<Reports>(`communities/${community!.id}/reports`),
    enabled: Boolean(community && staff && board.joined),
    refetchInterval: 10_000,
  });
  const hidden = useQuery({
    queryKey: ["community", community?.id, "hidden"],
    queryFn: () =>
      api<{ entries: EntryCard[] }>(`communities/${community!.id}/moderation/statuses`),
    enabled: Boolean(community && staff && board.joined),
    refetchInterval: 10_000,
  });
  const { run, pending } = useAction();
  const review = (entry: EntryCard, action: string) =>
    run(
      () =>
        api(`communities/${community!.id}/statuses/${entry.id}/review`, {
          method: "POST",
          body: { action, expectedVersion: entry.version },
        }),
      "Update reviewed.",
    );
  return (
    <AppShell community={community} role={board.role} active="moderation">
      <main className="page-content narrow-content">
        <div className="page-heading">
          <div>
            <span className="eyebrow">
              <ShieldCheck size={12} /> LOOKING AFTER YOUR LITTLE CORNER
            </span>
            <h1>A little care goes a long way.</h1>
            <p>Review reports, look after the board, and support your community.</p>
          </div>
        </div>
        {board.lookup.error || board.details.error ? (
          <ErrorState message={(board.lookup.error ?? board.details.error)!.message} />
        ) : !community || !board.role ? (
          <LoadingState />
        ) : !staff ? (
          <EmptyState title="For the people looking after this space">
            The streamer and board moderators manage this page.
          </EmptyState>
        ) : (
          <>
            <div className="filter-tabs admin-tabs">
              {[
                ["reports", `Reports · ${reports.data?.reports.length ?? 0}`],
                ["hidden", `Hidden updates · ${hidden.data?.entries.length ?? 0}`],
                ["people", "Community people"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={tab === value ? "active" : ""}
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "people" ? (
              <Members communityId={community.id} owner={board.role === "OWNER"} />
            ) : reports.error || hidden.error ? (
              <ErrorState message={(reports.error ?? hidden.error)!.message} />
            ) : tab === "reports" ? (
              reports.isPending ? (
                <LoadingState />
              ) : !reports.data?.reports.length ? (
                <EmptyState title="A little peace and quiet">
                  There are no open reports. Thanks for looking after your people.
                </EmptyState>
              ) : (
                <div className="admin-stack">
                  {reports.data.reports.map((report) => (
                    <article className="admin-section report-card" key={report.id}>
                      <div className="report-person">
                        <Avatar
                          name={report.entry.author.displayName}
                          url={report.entry.author.avatarUrl}
                          size="sm"
                        />
                        <strong>{report.entry.author.displayName}</strong>
                        <span>Reported by {report.reporter}</span>
                      </div>
                      <p className="report-body">{report.entry.body}</p>
                      <div className="report-reason">
                        <span>REASON FOR REVIEW</span>
                        <p>{report.reason}</p>
                      </div>
                      <div className="report-actions">
                        <button
                          className="button button-secondary"
                          disabled={pending}
                          onClick={() => void review(report.entry, "resolve")}
                        >
                          <Check size={14} />
                          Keep on board
                        </button>
                        {report.entry.allowOnStream && (
                          <button
                            className="button button-secondary"
                            disabled={pending}
                            onClick={() => void review(report.entry, "approve")}
                          >
                            <ShieldCheck size={14} />
                            Approve for stream
                          </button>
                        )}
                        <button
                          className="button button-quiet-danger"
                          disabled={pending}
                          onClick={() => void review(report.entry, "hide")}
                        >
                          <EyeOff size={14} />
                          Hide update
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )
            ) : hidden.isPending ? (
              <LoadingState />
            ) : !hidden.data?.entries.length ? (
              <EmptyState title="Nothing tucked away">
                Hidden updates appear here until their history expires.
              </EmptyState>
            ) : (
              <div className="admin-stack">
                {hidden.data.entries.map((entry) => (
                  <article className="admin-section report-card" key={entry.id}>
                    <div className="report-person">
                      <Avatar name={entry.author.displayName} size="sm" />
                      <strong>{entry.author.displayName}</strong>
                      <span>Hidden from the community</span>
                    </div>
                    <p className="report-body">{entry.body}</p>
                    <button
                      className="button button-secondary"
                      disabled={pending}
                      onClick={() => void review(entry, "restore")}
                    >
                      <RotateCcw size={14} />
                      Restore to board
                    </button>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}
