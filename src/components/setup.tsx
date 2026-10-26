"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Download, Users } from "lucide-react";
import { api } from "@/lib/api";
import { AppShell } from "./shell";
import { useBoard } from "./use-board";
import { useAction, useFeedback } from "./providers";
import { EmptyState, ErrorState, LoadingState } from "./ui";
import { SettingsForm } from "./admin";

type SetupState = {
  state: {
    profileReviewedAt: string | null;
    panelAddedAt: string | null;
    chatCommandAddedAt: string | null;
    overlayTestedAt: string | null;
    dismissedAt: string | null;
  };
  facts: { firstFollowerJoined: boolean; followerCount: number; overlayLinkGenerated: boolean };
};
type ShareKit = {
  communityUrl: string;
  panelImage: string;
  panelTitle: string;
  panelDescription: string;
  commandName: string;
  commandResponse: string;
};
function CopyField({ label, value }: { label: string; value: string }) {
  const { notify } = useFeedback();
  return (
    <div className="copy-field">
      <label>
        {label}
        <textarea
          aria-label={label}
          readOnly
          value={value}
          rows={value.length > 100 ? 3 : 2}
          onFocus={(event) => event.target.select()}
        />
      </label>
      <button
        className="button button-secondary"
        onClick={() => {
          if (!navigator.clipboard) {
            notify("Select and copy the text above.");
            return;
          }
          void navigator.clipboard.writeText(value).then(
            () => notify(`${label} copied.`),
            () => notify("Select and copy the text above."),
          );
        }}
      >
        <Copy size={14} /> Copy {label.toLowerCase()}
      </button>
    </div>
  );
}
export function Setup({ slug }: { slug: string }) {
  const board = useBoard(slug);
  const community = board.community;
  const owner = board.role === "OWNER";
  const router = useRouter();
  const { run, pending } = useAction();
  const [confirming, setConfirming] = useState<Record<string, boolean>>({});
  const setup = useQuery({
    queryKey: ["community", community?.id, "setup", board.session.data?.user?.id],
    enabled: Boolean(community && owner),
    queryFn: () => api<SetupState>(`communities/${community!.id}/setup`),
    refetchInterval: 10_000,
  });
  const kit = useQuery({
    queryKey: ["community", community?.id, "share-kit", board.session.data?.user?.id],
    enabled: Boolean(community && owner),
    queryFn: () => api<ShareKit>(`communities/${community!.id}/share-kit`),
  });
  const record = (step: string, completed: boolean) =>
    api(`communities/${community!.id}/setup`, { method: "PATCH", body: { step, completed } });
  const confirmation = (
    step: "panelAdded" | "chatCommandAdded" | "overlayTested",
    label: string,
  ) => (
    <label className="setup-confirmation">
      <input
        type="checkbox"
        disabled={pending}
        checked={
          confirming[step] ?? Boolean(setup.data?.state[`${step}At` as keyof SetupState["state"]])
        }
        onChange={(event) => {
          const checked = event.target.checked;
          setConfirming((previous) => ({ ...previous, [step]: checked }));
          void run(async () => {
            try {
              await record(step, checked);
              await setup.refetch();
            } finally {
              setConfirming((previous) => {
                const next = { ...previous };
                delete next[step];
                return next;
              });
            }
          }, "Your checklist is saved.");
        }}
      />
      {label}
    </label>
  );
  const completed =
    Number(Boolean(setup.data?.state.profileReviewedAt)) +
    Number(Boolean(setup.data?.state.panelAddedAt || setup.data?.state.chatCommandAddedAt)) +
    Number(Boolean(setup.data?.facts.firstFollowerJoined));
  return (
    <AppShell community={community} role={board.role} active="settings">
      <main className="page-content narrow-content setup-page">
        <div className="page-heading">
          <div>
            <span className="eyebrow">MAKE ROOM FOR YOUR PEOPLE</span>
            <h1>A warm welcome starts here.</h1>
            <p>Your community link, Twitch panel, and a few simple steps to get started.</p>
          </div>
        </div>
        {board.lookup.error || board.details.error || setup.error || kit.error ? (
          <ErrorState
            message={
              (board.lookup.error ?? board.details.error ?? setup.error ?? kit.error)!.message
            }
            retry={() => {
              void setup.refetch();
              void kit.refetch();
            }}
          />
        ) : !community || !board.role ? (
          <LoadingState />
        ) : !owner ? (
          <EmptyState title="The streamer sets up this space">
            Your streamer manages the sharing tools for this community.
          </EmptyState>
        ) : setup.isPending || kit.isPending ? (
          <LoadingState />
        ) : (
          kit.data &&
          setup.data && (
            <>
              <div className="setup-progress">
                <span>
                  <Check size={17} /> {completed} of 3 essentials ready
                </span>
                <Link className="text-button" href={`/c/${slug}`}>
                  Open your board ↗
                </Link>
              </div>
              {setup.data.state.dismissedAt && (
                <p className="notice">Welcome back. Your previous setup progress is saved.</p>
              )}
              <section className="setup-section">
                <span className="eyebrow">1 · MAKE IT FEEL FAMILIAR</span>
                <SettingsForm
                  community={community}
                  onSaved={() => record("profileReviewed", true)}
                />
              </section>
              <section className="admin-section setup-section">
                <span className="eyebrow">2 · SHARE YOUR LITTLE SPACE</span>
                <h2>One link for your community.</h2>
                <p>Followers sign in with Twitch, verify their follow, and choose to join.</p>
                <CopyField label="Community link" value={kit.data.communityUrl} />
                <a
                  className="text-button"
                  href={kit.data.communityUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open community link ↗
                </a>
                <p className="fine-print">
                  To test the follower journey, open this link in a private browser window with a
                  follower account.
                </p>
                <div className="setup-panel">
                  <img
                    src={kit.data.panelImage}
                    alt="SinceLastTime Twitch panel: What’s new since last stream?"
                    width={320}
                    height={160}
                  />
                  <a
                    className="button button-secondary"
                    href={kit.data.panelImage}
                    download="sincelasttime-twitch-panel.png"
                  >
                    <Download size={14} /> Download Twitch panel
                  </a>
                </div>
                <CopyField label="Panel title" value={kit.data.panelTitle} />
                <CopyField label="Panel description" value={kit.data.panelDescription} />
                <ol className="setup-instructions">
                  <li>Open your Twitch channel’s About page and turn on Edit Panels.</li>
                  <li>Add a text/image panel and upload the graphic.</li>
                  <li>
                    Set the image link to your community link and paste the title and description.
                  </li>
                  <li>Save the panel and test its link.</li>
                </ol>
                {confirmation("panelAdded", "I added and tested my Twitch panel link.")}
                <h3>Give chat a familiar command.</h3>
                <CopyField label="Command name" value={kit.data.commandName} />
                <CopyField label="Command response" value={kit.data.commandResponse} />
                <p className="fine-print">
                  Add these in the command settings of the chatbot you already use. This page
                  supplies the text; your bot sends it when you configure the command.
                </p>
                {confirmation("chatCommandAdded", "I added and tested the chat command.")}
              </section>
              <section className="admin-section setup-section">
                <span className="eyebrow">3 · WELCOME THE FIRST FOLLOWER</span>
                <h2>
                  <Users size={21} />{" "}
                  {setup.data.facts.firstFollowerJoined
                    ? "Your first people are here."
                    : "Invite someone into the conversation."}
                </h2>
                <p>
                  {setup.data.facts.firstFollowerJoined
                    ? `${setup.data.facts.followerCount} community members have joined. This step is checked automatically.`
                    : "Share your community link with a follower. We’ll update this step when they sign in and join."}
                </p>
              </section>
              <section className="admin-section setup-section">
                <span className="eyebrow">OPTIONAL · BRING A STORY ON STREAM</span>
                <h2>Set up your OBS overlay.</h2>
                <p>
                  {setup.data.facts.overlayLinkGenerated
                    ? "An overlay link has been generated. Test it in OBS before confirming below."
                    : "Generate your private overlay link from the conversation studio and add it as a Browser Source in OBS."}
                </p>
                <Link className="button button-secondary" href={`/c/${slug}/studio`}>
                  Open OBS setup in the studio
                </Link>
                {confirmation("overlayTested", "I tested the overlay in OBS.")}
                <p className="fine-print">
                  Your confirmation records your own test. Keep the OBS link private; it is separate
                  from your community link.
                </p>
              </section>
              <div className="page-actions">
                <Link className="button button-primary" href={`/c/${slug}/briefing`}>
                  Open your streamer briefing
                </Link>
                <button
                  className="text-button"
                  disabled={pending}
                  onClick={() =>
                    void run(async () => {
                      await record("dismissed", true);
                      router.push(`/c/${slug}`);
                    })
                  }
                >
                  Finish setup later
                </button>
              </div>
            </>
          )
        )}
      </main>
    </AppShell>
  );
}
