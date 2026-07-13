# Reference Library — Deploy Runbook

The reference library needs two things in production:

- **The embedding model** — mounted from the `/data` volume at runtime. It is **not**
  committed or baked, because its weights (~130MB) exceed GitHub's 100MB file limit.
- **The SRD corpus** (`reference-data/srd/`) — small, committed markdown, baked into
  the image (used by the ingestion scripts).

Generated vectors live in the `/data` SQLite DB (persisted volume), not in the image.

## One-time: put the embedding model on the box

The app reads the model from `REFERENCE_MODEL_DIR` (set to `/data/reference-models` in
`docker-compose.yml`), which maps to `./data/reference-models` on the host.

1. On any machine with Node + this repo checked out, fetch the model into a local dir:

   ```sh
   REFERENCE_MODEL_DIR=./reference-models npx tsx scripts/reference/fetch-model.ts
   ```

   This downloads `Xenova/bge-small-en-v1.5` (ONNX) into `./reference-models/Xenova/...`.

2. Copy that `reference-models/` directory onto the Unraid host next to the app's data,
   so it lands at `<appdata>/data/reference-models` (i.e. the `./data` the compose file
   mounts as `/data`). For example:

   ```sh
   scp -r ./reference-models  user@unraid:/mnt/user/appdata/encounter-tracker/data/reference-models
   ```

   The container then sees it at `/data/reference-models` via `REFERENCE_MODEL_DIR`.

You can also run step 1 directly on the Unraid box if it has Node, writing straight into
the mounted `data/reference-models`. Either way it's a one-time step — the model persists
on the volume across redeploys.

## SRD corpus (committed + baked)

Place openly-licensed SRD markdown in `reference-data/srd/` and commit it. It's baked into
the image and used by `import-srd.ts`. (`.pdf` files and `models/` are git-ignored.)

## After each deploy: index sources

Vectors are stored in the `/data` SQLite DB, not the image. Run the ingestion scripts once
per source (from a checkout/environment that can reach the prod DB — set `DB_PATH` to the
`/data/encounter-tracker.db` file, and `REFERENCE_MODEL_DIR` to the model dir):

```sh
npx tsx scripts/reference/import-srd.ts
npx tsx scripts/reference/ingest.ts <book.pdf> --collection "<name>" --notes "<context for the assistant>"
```

Check **Settings → Reference Library** in the app to confirm what loaded (collections,
chunk counts) and to edit each source's note.

## Persistence summary

- **Embedding model** — on the `/data` volume; survives redeploys; set once.
- **Vectors** — in the `/data` SQLite DB; survive redeploys; re-run ingestion only if the
  DB is wiped or the model/chunking changes.
- **SRD markdown** — committed + baked; comes back on every image build.
