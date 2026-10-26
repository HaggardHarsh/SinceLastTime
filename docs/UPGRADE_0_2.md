# Upgrading to SinceLastTime 0.2

This release fixes author-management, retention, presentation, search, selection, concurrency, and mobile account shortcomings. It adds private acknowledgements, community-only follow-ups, an owner briefing, and Twitch setup/sharing tools.

## Apply the release

1. Back up the database and preserve the existing encryption key.
2. Schedule the upgrade outside an active conversation segment.
3. Apply committed migrations with `npm run db:migrate`.
4. Deploy web and worker from the same release, or rebuild the production Compose services together.
5. Check `/api/readiness`: database, maintenance, and OAuth worker progress should be healthy. Inspect `overdueAccounts` if validation is delayed.
6. Open setup and download the panel. Docker images must include the `public` directory; the current Dockerfile does.

The migrations are additive. Existing entries start at content version 1. Existing invitations use that source version. Historical acknowledgements are not inferred or manufactured. An old queue item without a recorded shown version must be shown again before it can be marked discussed. Existing completed discussions and fairness counters are preserved.

Preserve the initial composite story/current-entry ownership constraints, the active-segment partial unique index, and the retention-backlog partial index in future schema changes. Do not reset an existing database or run the demo seed against production.

## User-visible routes

| Route               | Audience         | Purpose                                                                    |
| ------------------- | ---------------- | -------------------------------------------------------------------------- |
| `/account/updates`  | Signed-in author | Manage retained posts, including hidden posts and inaccessible communities |
| `/c/:slug/briefing` | Community owner  | Read actual context and deliberately acknowledge updates                   |
| `/c/:slug/setup`    | Community owner  | Profile review, canonical links, panel downloads, chatbot text, checklist  |

The mobile account menu exposes Your updates and logout. New community creation opens setup. Setup can be dismissed and reopened from settings or the owner’s board.

## API changes

All APIs retain the `{ data }` / `{ error }` envelope and no-store response policy. Mutations still require same-origin JSON. New APIs are application APIs rather than Twitch-native profile changes.

| Endpoint                                                     | Behavior                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `GET /api/me/statuses?communityId=&cursor=`                  | Thirty retained author-owned posts per page; membership-independent                        |
| `DELETE /api/me/statuses/:id`                                | Idempotent owned deletion; other authors receive 404                                       |
| `PATCH /api/me/statuses/:id/preferences`                     | `expectedVersion` plus `allowOnStream:false` and/or `allowFollowUp:false`; revocation only |
| `GET /api/communities/:id/statuses?q=&category=&cursor=`     | Full server search by body/display name/login; literal wildcard handling                   |
| `GET /api/communities/:id/candidates?segmentId=&q=&cursor=`  | Staff-only, thirty eligible broadcast candidates per page                                  |
| `PUT /api/communities/:id/statuses/:entryId/acknowledgement` | Owner-only; requires `expectedVersion`; no text payload                                    |
| `GET /api/communities/:id/briefing?cursor=`                  | Owner-only, ten current updates per page with retained context                             |
| `GET/PATCH /api/communities/:id/setup`                       | Owner checklist facts and explicit completion confirmations                                |
| `GET /api/communities/:id/share-kit`                         | Owner-only canonical community URL, static asset path, panel and command copy              |

Public reply and follow-up creation now require `expectedVersion`. Replies acknowledge in the same transaction and produce the reply notification only. Follow-ups accept current-version acknowledgement or discussion, require explicit author permission, and store the source content version.

Studio state no longer returns a bulk `candidates` array. Use the candidate endpoint. Queue items include `entryId`, `shownVersion`, and `unavailableReason`; `entry` is null when content cannot be returned. The response also includes the actually resolved `overlay` selection. Historical shown state does not imply current presentation. Discussion completion requires `expectedVersion` matching both current content and the shown version.

Entry cards include `contentVersion`. The `acknowledgement` property is omitted entirely for viewers other than the author and owner. For authorized viewers it is null or contains receipt time, content version, and streamer display name. Permission-only changes preserve the receipt; actual content edits require acknowledgement again. Removed/expired text is not copied into receipt records.

## Privacy and operational behavior

- Viewing the board, briefing, or story sends no read receipt.
- Written streamer responses are community-visible. Acknowledgement is private to author/streamer.
- Acknowledgement does not consume broadcast rotation or mark a discussion completed.
- Withdrawal, deletion, moderation, version changes, and retention are checked again when an action occurs.
- Former/suspended members retain ownership controls without regaining community access. Reconnecting the same Twitch identity is required if their sign-in has expired.
- Worker cleanup uses bounded short transactions; large backlogs make progress over successive passes.
- The OBS credential remains separate from public share links and command text.

## Verification

The release has 36 unit tests, 20 HTTP/PostgreSQL scenarios, and ten Chromium journeys. Concurrency tests pause real requests around transaction boundaries; worker tests hold external validation while actual database maintenance completes. Fresh-database and repeated migration checks verify the SQL safeguards.

Browser coverage includes personal acknowledgements/follow-ups, exact briefing context, overlay clearing/review, cross-page search, panel download, persistent setup confirmations, and mobile author deletion/logout. Screenshots: [briefing](screenshots/briefing.png), [setup](screenshots/setup.png).

Use real Twitch credentials for the final OAuth/follower walkthrough and a physical OBS broadcast. The automated adapter uses service fixtures, and browser tests exercise the actual overlay webpage. The embedded Twitch Extension, AI summaries, private messaging, push notifications, and full account export/deletion are not part of 0.2.
