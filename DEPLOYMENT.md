# Deployment

encounter-tracker deploys to a self-hosted Unraid server via a GitHub Actions
pipeline that builds a Docker image and pushes it to GHCR, then triggers a
webhook on the Unraid box to pull and restart the container. There is no
scheduled/polling update check — deploys only happen in response to a push
to `main`.

## How it works

```
push to main
  -> GitHub Actions: build image, push to ghcr.io/zachauker/5e-encounter-tracker:latest
  -> GitHub Actions: POST to the deploy webhook (signed with a shared secret)
  -> Unraid: webhook container runs scripts/update.sh
       -> git pull (keeps docker-compose.yml etc. in sync)
       -> docker compose pull (fetches the new image)
       -> docker compose up -d --remove-orphans (recreates the container)
       -> docker image prune -f (cleans up the old image layer)
```

Database migrations run automatically on container startup
(`instrumentation.ts` calls `runMigrations()`, an idempotent
`CREATE TABLE IF NOT EXISTS`-based script) — no manual migration step is
ever needed.

## Components

| Piece | Where it lives | What it does |
|---|---|---|
| `.github/workflows/docker.yml` | this repo | Builds + pushes the image on every push to `main`, then calls the deploy webhook |
| `scripts/update.sh` | this repo, deployed to Unraid | The actual pull-and-restart logic |
| `docker-compose.yml` | this repo, deployed to Unraid | Defines the `encounter-tracker` app container |
| `docker/webhook/` | this repo, deployed to Unraid | A small [`adnanh/webhook`](https://github.com/adnanh/webhook) listener (built from source, not a pulled image) that verifies the request and runs `scripts/update.sh` |

The webhook container is intentionally narrow in scope: it does exactly one
thing (verify a shared secret, run one fixed script) rather than being a
general-purpose auto-updater. It's built from `adnanh/webhook`'s actual
GitHub source in `docker/webhook/Dockerfile`, not a pre-built third-party
image, so what's running is fully auditable — this matters because the
container has Docker socket access.

## One-time setup on the Unraid host

### 1. Pick the canonical deploy directory

Decide on **one** absolute path that will hold this repo's checkout,
`docker-compose.yml`, and the real `./data` volume (your live database) —
e.g. `/mnt/user/appdata/encounter-tracker`. This exact path is used in three
places below and must match everywhere. Using the wrong path anywhere in this
chain risks pointing a deploy at an empty `./data` instead of your real one.

```bash
git clone git@github.com:zachauker/5e-encounter-tracker.git /mnt/user/appdata/encounter-tracker
cd /mnt/user/appdata/encounter-tracker
docker compose up -d
```

### 2. Stand up the webhook listener

```bash
cd /mnt/user/appdata/encounter-tracker/docker/webhook
cp .env.example .env
```

Edit `.env`:
- `WEBHOOK_SECRET` — generate one with `openssl rand -hex 32`
- `DEPLOY_PATH` — the same path from step 1

```bash
docker compose up -d --build
```

### 3. Expose it through your reverse proxy

Route a hostname/path (through your existing `oakwoodproxy`-networked
reverse proxy) to this container on port `9000`, e.g.
`https://deploy.yourdomain.com` -> `encounter-tracker-webhook:9000`. The
actual hook endpoint is `/hooks/deploy` (adnanh/webhook's convention: the
`id` field in `hooks.json`, prefixed with `/hooks/`) — so the full URL
GitHub will call is `https://deploy.yourdomain.com/hooks/deploy`.

### 4. Configure GitHub

In the repo on GitHub: **Settings -> Secrets and variables -> Actions**

- **Secrets -> New repository secret**: `DEPLOY_WEBHOOK_SECRET` = the same
  value as `WEBHOOK_SECRET` from step 2.
- **Variables -> New repository variable**: `DEPLOY_WEBHOOK_URL` = the full
  URL from step 3 (e.g. `https://deploy.yourdomain.com/hooks/deploy`).

### 5. Verify

Push a small commit to `main` and watch the Actions run — the `build-push`
job should succeed, then `deploy` should run and return `200`. Check
`docker logs encounter-tracker-webhook` on Unraid to confirm the hook fired
and ran `scripts/update.sh`, and `docker logs encounter-tracker` to confirm
the app container restarted on the new image.

## Manual deploy (fallback)

If the webhook is ever down or you just want to force a redeploy without
pushing a commit:

```bash
cd /mnt/user/appdata/encounter-tracker   # your DEPLOY_PATH
./scripts/update.sh
```

## Rotating the webhook secret

1. Generate a new secret: `openssl rand -hex 32`
2. Update `WEBHOOK_SECRET` in `docker/webhook/.env`, then
   `docker compose up -d` in `docker/webhook/` to pick it up.
3. Update the `DEPLOY_WEBHOOK_SECRET` GitHub Actions secret to match.
