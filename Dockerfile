# Off-Guard.
#
# Two stages, for one reason: better-sqlite3 is a native module and needs a
# C++ toolchain to install, which has no business being in the image that runs
# at a table. The build stage compiles it; the runtime stage gets the result.

FROM node:22-bookworm-slim AS build

# What better-sqlite3 needs to build, and nothing else.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/off-guard

# Dependencies first, so a source change does not recompile SQLite.
COPY package.json package-lock.json ./
# `npm ci --omit=dev` from the lockfile: reproducible, and no Playwright or
# Vitest in an image that only has to serve.
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS runtime

# `tini` so the container has a real init: without one, node is PID 1 and
# SIGTERM handling and zombie reaping are both its problem.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/off-guard

COPY --from=build /srv/off-guard/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY migrations ./migrations
COPY public ./public
COPY tools ./tools
# The reference drawer's corpus is checked in and belongs in the image. The
# creature catalogue is not: it is 67 MB of build output, and is mounted at
# runtime by whoever built it.
COPY data/reference.json ./data/reference.json
COPY data/licenses ./data/licenses

# Loopback by default is right for systemd and wrong for a container, where
# nothing outside can reach it. The compose file publishes the port to
# 127.0.0.1 on the host instead, so the exposure is the same either way.
ENV NODE_ENV=production \
    OFF_GUARD_HOST=0.0.0.0 \
    OFF_GUARD_PORT=8787 \
    OFF_GUARD_DB=/var/lib/off-guard/off-guard.sqlite

# `node` exists in the base image as uid 1000. The database directory is the
# only thing this user needs to write.
RUN mkdir -p /var/lib/off-guard && chown -R node:node /var/lib/off-guard
USER node

EXPOSE 8787

# Health, not readiness: /healthz answers without touching the database, so a
# slow query cannot make the container look dead and get restarted mid-session.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.OFF_GUARD_PORT||8787)+(process.env.OFF_GUARD_BASE_PATH||'')+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server/index.js"]
