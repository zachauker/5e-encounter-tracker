#!/usr/bin/env bash
set -euo pipefail
# Range-capable static server for the standalone preview. Uses a small Node
# server (scripts/world/serve-preview.js) because python's http.server does
# not honor HTTP Range requests, which the PMTiles reader requires.
# Open http://localhost:8080/  (redirects to /preview/).
node scripts/world/serve-preview.js
