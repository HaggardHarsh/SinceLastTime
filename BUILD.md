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

## Verification coverage

- 31 unit checks across authentication, configuration, status validation, ranking, overlay eligibility, and the Twitch adapter.
- Four real HTTP/PostgreSQL workflow scenarios covering authorization, consent, concurrent operations, reminders, moderation, and retention.
- Five Chromium acceptance scenarios covering the viewer/streamer journey, actual overlay display, non-follower denial, mobile behavior, and public navigation.
- Production compilation, configuration validation, and web/worker boot checks.

Live Twitch authorization and a physical OBS broadcast require the deployer’s Twitch application credentials. The real integration and instructions are included; automated Twitch service responses use fixtures.
