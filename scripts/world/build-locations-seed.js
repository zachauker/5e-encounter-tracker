#!/usr/bin/env node
/* Generates world-data/build/locations-seed.json — the normalized, deduped list
   of the ~198 Exandria places (name, lng, lat, type, description, minZoom) that
   the in-app importer (POST /api/world/import-locations) seeds into a campaign.
   Reuses the same load/dedupe logic as scripts/world/seed-locations.js so the
   two never diverge. Regenerate + re-commit whenever the source GeoJSON or the
   seed logic changes (this file is committed and baked into the Docker image).
   Run:  node scripts/world/build-locations-seed.js */
const fs = require("fs");
const path = require("path");
const { loadRecords, dedupe } = require("./seed-locations.js");

const OUT = path.join("world-data", "build", "locations-seed.json");

const records = dedupe(loadRecords()).map((r) => ({
  name: r.name,
  lng: r.lng,
  lat: r.lat,
  type: r.type,
  description: r.description,
  minZoom: r.minZoom,
}));

fs.writeFileSync(OUT, JSON.stringify(records));
console.log(`Wrote ${records.length} location records to ${OUT}`);
