# Deployment

Run a web process, worker process, and persistent PostgreSQL database. The production Compose file runs all three plus a one-shot migration service.

## Configure

```bash
cp .env.production.example .env.production
openssl rand -base64 32
```

Fill every placeholder:

| Variable               | Value                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`         | PostgreSQL URL reachable by web and worker; Compose hostname is `db` |
| `POSTGRES_PASSWORD`    | Password used when the production volume is first initialized        |
| `APP_BASE_URL`         | Public HTTPS origin, such as `https://sincelasttime.yourdomain.com`  |
| `TWITCH_CLIENT_ID`     | Confidential Twitch application ID                                   |
| `TWITCH_CLIENT_SECRET` | Twitch application secret                                            |
| `TOKEN_ENCRYPTION_KEY` | The generated 32-byte base64 key                                     |
| `DEMO_MODE`            | `false`                                                              |

The password in `DATABASE_URL` must match `POSTGRES_PASSWORD`; URL-encode special characters. Preserve the same encryption key across web, worker, and restarts so existing tokens remain decryptable.

Register this exact redirect in the Twitch application:

```text
https://sincelasttime.yourdomain.com/api/auth/twitch/callback
```

Production environment files are ignored by Git and excluded from image builds.

## Start

```bash
docker compose --env-file .env.production -f compose.production.yaml up --build -d
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs web worker
```

The migration service waits for PostgreSQL, applies committed migrations, and exits. Web and worker start after successful migration. The web service listens on host loopback port 3000; put an HTTPS reverse proxy in front of it.

Example Caddy configuration:

```caddyfile
sincelasttime.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
```

On another host, build the same image, configure the same variables, run `npm run db:migrate` as a release step, then run `npm start` and `npm run worker` as separate services. The runtime image includes the migration and worker toolchain.

Production startup rejects demo mode, missing Twitch settings, an invalid encryption key, or an HTTP public origin. Use a fresh production database; development identities are fixtures.

## Check

```bash
curl https://sincelasttime.yourdomain.com/api/health
curl https://sincelasttime.yourdomain.com/api/readiness
```

Both should return successful JSON. Readiness waits for a worker heartbeat and fails when it becomes stale.

Use separate browser profiles for a manual Twitch check: sign in as the streamer and create a board, then sign in as a follower and join. Post an update, grant broadcast permission, prepare and approve a card, and show it through OBS. Withdraw permission in the viewer profile and confirm that it clears.

## Maintain

- Back up the PostgreSQL volume before migration releases.
- Keep web and worker on the same application version.
- Preserve the encryption key and database together for recovery.
- Watch the worker heartbeat, failed OAuth validation events, and database availability.
- Generate a new OBS link when its access needs to be replaced.

No EventSub webhook, public worker port, AI API key, or external email service is required for this release.
