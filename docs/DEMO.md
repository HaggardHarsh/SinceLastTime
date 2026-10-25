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
2. **0:20–0:50 — A little update.** As Maya, share an update and show the separate broadcast and reminder choices.
3. **0:50–1:15 — Make time.** Switch to Luna’s studio. Prepare a lineup; explain rotation slots, the community favorite, and a follow-up.
4. **1:15–1:45 — A conversation.** Review a card, start the segment, and show it through an actual OBS Browser Source or the overlay page. Respond and mark it discussed.
5. **1:45–2:15 — What happened next.** Use Maya’s prepared interview/job-offer story to show continuity. Identify it as an earlier illustrative story rather than implying days passed during the recording.
6. **2:15–2:40 — Pick it up again.** Show the new chapter and approved earlier context. Demonstrate how a welcomed follow-up becomes another update.
7. **2:40–3:00 — How it was built.** Show the meaningful Git milestones and Codex’s role in implementing and testing the flows.

## OBS setup

From Luna’s studio, open **OBS setup**, generate the URL, and copy it into a Browser Source at 1920 × 1080. Keep the read-only link out of recorded setup screens. Only **Show on stream** presents a card; **Clear overlay** and **End segment** remove it.

Automated acceptance tests exercise the overlay browser page directly. A final Twitch broadcast and physical OBS check should use real Twitch app credentials.

## Submission materials

Primary Codex build session ID, read from the build runtime:

```text
01a1743e-d7bc-7533-915d-9729a49b3157
```

Codex implemented the application, database migration, Twitch integration, community and studio interfaces, automated tests, production packaging, and documentation across the twenty recorded milestones.

- Repository with source, assets, migrations, and setup instructions.
- Public video of at most three minutes showing the application on Twitch and how Codex was used.
- Description explaining the personal-update → conversation → follow-up experience.
- Codex session ID for the conversation where most development occurred, available in the client’s session details.

Avoid claiming the first implementation of community statuses. The differentiated experience is channel-scoped viewer stories, fair conversation selection, explicit broadcast consent, and continuity across streams.
