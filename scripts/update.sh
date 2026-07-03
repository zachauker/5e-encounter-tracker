#!/bin/sh
# Syncs docker-compose.yml (in case it changed) and pulls the latest
# encounter-tracker image, recreating the container if either changed.
#
# Called two ways:
#   1. By the "deploy" job in .github/workflows/docker.yml, via the
#      self-hosted runner, right after a push to main builds a new image.
#   2. Optionally on a cron schedule (Unraid User Scripts / crontab) as a
#      fallback, in case the runner is ever offline.
#
# Must always be run from the one canonical deploy directory on the host —
# the one containing the real ./data volume with the live database. Running
# it from a different checkout would point docker-compose at an empty
# ./data and orphan the real one.
set -e
cd "$(dirname "$0")/.."
git pull
docker compose pull
docker compose up -d --remove-orphans
docker image prune -f
