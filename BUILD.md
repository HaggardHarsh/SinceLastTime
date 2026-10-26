# Implementation milestones

SinceLastTime was built in twenty coherent Git milestones:

1. Next.js foundation and SinceLastTime branding.
2. PostgreSQL model, migration, ownership constraints, and fixtures.
3. Twitch OAuth, encrypted credentials, and opaque sessions.
4. Verified-follower communities and membership authorization.
5. Status publishing, expiration, edits, deletion, and consent.
6. Linked stories and community-specific profile history.
7. Reactions and community nominations.
8. Moderation APIs, board roles, reports, and streamer replies.
9. Hybrid fair selection and persisted conversation segments.
10. Version-checked public OBS presentation.
11. Opt-in follow-ups, notifications, and maintenance worker.
12. Responsive community board and status composer.
13. Profiles, catch-up inbox, and community discovery.
14. Streamer studio, lineup editing, review, and OBS setup.
15. Moderator screens, member controls, and owner settings.
16. Landing experience and explanation of sharing choices.
17. Unit/HTTP/PostgreSQL verification and concurrency hardening.
18. Chromium desktop/mobile acceptance journeys.
19. Production packaging, startup validation, readable source, and CI.
20. Setup, deployment, architecture, and demo documentation with verified screenshots.

## 0.2 upgrade milestones

The subsequent release implements the reviewed shortcomings and selected product upgrades in coherent commits:

1. Additive attention/setup schema and shared retention, pagination, and locking helpers.
2. Author controls, mobile account menu, read-time retention, accurate overlay state, server search, and database-wide fair selection.
3. Private version-specific acknowledgements, community-only follow-ups, public reply integration, and exact story briefings.
4. Streamer onboarding, branded panel download, sharing copy, checklist persistence, and readable sign-in failures.
5. Independent worker loops, bounded maintenance, and deterministic database race tests.
6. Minimal overlay projections, database counts, purge backlog index, and membership/presentation edge cases.
7. Production packaging, migration verification, upgraded walkthrough, and documented API contracts.

## Verification coverage

- 35 unit checks across authentication, configuration, status validation, ranking, retention, pagination, concurrency, membership access, overlay eligibility, and the Twitch adapter.
- Twenty real HTTP/PostgreSQL scenarios covering author controls, privacy, controlled request interleavings, version checks, 520-entry selection, reminders, moderation, retention, independent worker jobs, setup, and sign-in error redirects.
- Nine Chromium acceptance scenarios covering the viewer/streamer journey, private acknowledgement, community-only follow-ups, briefing context, actual overlay display/clearing, setup downloads, search beyond the first page, and mobile ownership/logout.
- Production compilation, configuration validation, and web/worker boot checks.

Live Twitch authorization and a physical OBS broadcast require the deployer’s Twitch application credentials. The real integration and instructions are included; automated Twitch service responses use fixtures.
