# Demo walkthrough

Follow the README’s local demo instructions, seed the fixtures, and run web and worker. All names and updates in the seed are illustrative demo content.

| Identity  | Perspective                                         |
| --------- | --------------------------------------------------- |
| `maya`    | Viewer with an interview story and a new job update |
| `luna`    | Streamer and owner of `/c/luna`                     |
| `rohan`   | Board moderator                                     |
| `olive`   | Viewer with a community-favorite sourdough update   |
| `visitor` | Non-follower who cannot join                        |

Additional viewers: Kai, Nina, Ben, Jules, and Avery. Ben’s status is community-only to demonstrate separate broadcast consent.

## Three-minute story

1. **0:00–0:20 — The problem.** Show the board: every username has a life outside chat, and a short update gives it a place.
2. **0:20–0:45 — A viewer’s choice.** As Maya, open the current job update’s sharing preferences and make it community-only. Keep a follow-up welcome. Show that public broadcast and personal attention are separate choices.
3. **0:45–1:15 — Remember the person.** Switch to Luna’s **Before you go live** briefing. Show Maya’s actual interview chapter, Luna’s earlier reply, and the new job update. These are seeded illustrative events; do not imply days passed during the recording.
4. **1:15–1:40 — Acknowledge privately.** Deliberately acknowledge Maya’s update and optionally invite a follow-up. Switch to Maya to show the private receipt. Opening the briefing alone does not send one.
5. **1:40–2:10 — A public conversation.** As Luna, prepare a studio lineup, review a broadcast-permitted card such as Olive’s, start the segment, and show it in the overlay. Explain the rotation slots and community pick. Clear the overlay to show the accurate selected/history distinction.
6. **2:10–2:35 — Welcome the community.** Open setup, show the canonical link, download the Twitch panel, and show ready-to-paste `!since` text. The app supplies sharing tools; the streamer configures their panel/bot on Twitch.
7. **2:35–3:00 — How it was built.** Show meaningful Git milestones, the privacy/concurrency regressions, and Codex’s role in implementing and testing the flows. Mention Your updates author controls for people who leave a community.

## OBS setup

From Luna’s studio, open **OBS setup**, generate the URL, and copy it into a Browser Source at 1920 × 1080. Keep the read-only link out of recorded setup screens. Only **Show on stream** presents a card; **Clear overlay** and **End segment** remove it.

Automated acceptance tests exercise the overlay browser page directly. A final Twitch broadcast and physical OBS check should use real Twitch app credentials.

## Submission materials

Primary Codex build session ID, read from the build runtime:

```text
01a1743e-d7bc-7533-915d-9729a49b3157
```

Codex implemented the original application across twenty recorded milestones and the subsequent 0.2 release with privacy fixes, acknowledgements, briefings, onboarding, worker isolation, and expanded automated coverage. See [the milestone record](../BUILD.md).

- Repository with source, assets, migrations, and setup instructions.
- Public video of at most three minutes showing the application on Twitch and how Codex was used.
- Description explaining the personal-update → conversation → follow-up experience.
- Codex session ID for the conversation where most development occurred, available in the client’s session details.

Avoid claiming the first implementation of community statuses. The differentiated experience is channel-scoped viewer stories, fair conversation selection, explicit broadcast consent, and continuity across streams.
