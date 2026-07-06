FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat python3 make g++

FROM base AS deps
COPY package*.json ./
RUN npm install --prefer-offline

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The world-map artifacts (world-data/build) are git-ignored but baked into the
# runtime image below, so they must be present in the build context. Fail fast
# with instructions rather than shipping an image whose /world 404s at runtime.
RUN test -f world-data/build/styles/themes.json || \
  (echo "ERROR: world-data/build artifacts missing from the build context. Generate them before 'docker build': scripts/world/fetch-geojson.sh && scripts/world/build-tiles.sh && node scripts/world/build-glyphs.js && node scripts/world/build-themes.js" && exit 1)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
WORKDIR /app
LABEL net.unraid.docker.icon="https://game-icons.net/icons/d4af37/000000/1x1/delapouite/dice-twenty-faces-twenty.png"
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache su-exec
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Next.js's standalone output file-tracing only follows static JS requires, so it
# misses libvips' shared library (e.g. libvips-cpp.*.so) that sharp's native
# binding loads dynamically at runtime — without this, sharp's module loads fine
# but operations like .tile() (dzsave) fail with "VipsOperation: class ... not
# found". Overlaying the complete, untraced packages from the builder stage
# fixes this.
COPY --from=builder /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder /app/node_modules/@img ./node_modules/@img
# Bake the world-map artifacts (pmtiles + glyphs + styles, ~17MB) into the image
# so /api/world serves them from the default WORLD_DIR (cwd/world-data/build) with
# no volume mount or WORLD_DATA_DIR needed. Set WORLD_DATA_DIR to override with a
# mounted volume instead.
COPY --from=builder /app/world-data/build ./world-data/build
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /data
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DB_PATH=/data/encounter-tracker.db

ENTRYPOINT ["docker-entrypoint.sh"]
