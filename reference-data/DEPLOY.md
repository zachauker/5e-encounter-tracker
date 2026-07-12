# Reference Library — Deploy Runbook

The reference library needs two things baked into the Docker runtime image:
the local embedding model (`reference-data/models`) and the SRD corpus
(`reference-data/srd`). Both are committed to the repo and copied from the
builder stage into the runtime stage in the `Dockerfile`, the same way
`world-data/build` is baked for the world map.

## One-time setup (on a dev machine, needs network)

1. Fetch the embedding model weights (~130MB) into `reference-data/models`:

   ```sh
   REFERENCE_MODEL_DIR=reference-data/models npx tsx scripts/reference/fetch-model.ts
   ```

   This downloads the ONNX weights for `Xenova/bge-small-en-v1.5` via
   `@huggingface/transformers` and caches them under `reference-data/models`.

2. Commit the weights:

   ```sh
   git add reference-data/models
   git commit -m "chore: commit reference embedding model weights"
   ```

   `reference-data/.gitignore` no longer ignores `models/` — the plan is to
   bake the weights into the image, so they need to be committed, not
   downloaded at build or runtime.

3. Place openly-licensed SRD markdown files in `reference-data/srd/` and
   commit them too.

## What the Dockerfile does

- The builder stage has a guard: `RUN test -d reference-data/models || ...`.
  If the model directory is missing from the build context, `docker build`
  fails fast with instructions instead of shipping an image with no local
  embedding model.
- The runtime stage copies both directories from the builder stage:
  `reference-data/models` and `reference-data/srd`.
- `lib/reference/embed.ts` defaults `REFERENCE_MODEL_DIR` to
  `path.join(process.cwd(), "reference-data", "models")`, which matches
  where the image places them — no env var or volume mount is required in
  production.

## After each deploy

Vectors are computed from source text and stored in the `/data` SQLite DB
(the persisted volume), not baked into the image. After each deploy, run
the ingestion scripts on the server (inside the running container, or via
`docker exec`):

```sh
npx tsx scripts/reference/import-srd.ts
npx tsx scripts/reference/ingest.ts <book> --collection "<name>"
```

Run `ingest.ts` once per source/book you want indexed. Check
Settings → Reference Library in the app to confirm what loaded and how many
chunks/collections are present.

## Notes on persistence

- The embedding model and SRD markdown are static and baked into the image
  itself — they come back on every redeploy with no extra steps.
- The generated vectors live in the SQLite DB at `/data` (the persisted
  Docker volume), so they survive redeploys without re-ingesting.
- If the DB volume is ever wiped or you need to regenerate embeddings (e.g.
  after changing the embedding model or chunking logic), re-run the
  ingestion scripts above.
