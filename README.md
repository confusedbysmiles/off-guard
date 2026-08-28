# Off-Guard

A self-hosted Pathfinder Second Edition table application: a GM dashboard, a
persistent character sheet for each player, and a shared read-only initiative
screen the whole table can watch. Built to run at a live table on a laptop, a
phone and a TV at the same time.

Multiple concurrent campaigns are first-class. A character belongs to exactly
one campaign; an encounter belongs to one campaign but can be copied to another;
creature data, reference tables and homebrew are global.

**Status: milestone 1 of 9.** The data pipeline and rules-engine inputs exist.
There is no server and no interface yet.

| # | Milestone | State |
|---|-----------|-------|
| 1 | Data pipeline, normalized creature format, inline-markup resolver | done |
| 2 | Rules engine + tests | next |
| 3 | Server, schema, migrations, token access, campaign-scoped API | |
| 4 | Player character sheet, Pathbuilder import | |
| 5 | GM dashboard: campaigns, party panel, encounter builder, XP budget | |
| 6 | Initiative tracker | |
| 7 | Shared screen over SSE | |
| 8 | Reference drawer, dice roller, Recall Knowledge helper | |
| 9 | Deployment, accessibility and security pass | |

## Running it

```bash
npm install
npm run build:data   # ~7 minutes on a cold cache, ~6 seconds after
npm test
```

`build:data` clones the pinned `foundryvtt/pf2e` commit into `.cache/` (sparse,
packs only) and writes `data/creatures/`, `data/hazards/`, `data/index.json` and
`data/traits.json`. Those outputs are generated and gitignored; the pinned commit
lives in `tools/build-data/upstream.lock.json` and is bumped deliberately, never
automatically. Tests run against committed fixtures of raw upstream JSON, so
`npm test` does not require a data build.

## Stack, and why

- **Node 20+, no build step, no bundler, no CDN.** Front end is vanilla HTML,
  CSS and ES modules; every font and asset is self-hosted. The point is that a
  file can be opened in an editor and read two years from now.
- **Fastify** over Express. Both would work. Fastify wins on dependency count
  for what this app actually needs: schema-based validation and serialization
  are built in (character-sheet writes need validating, and there is no ORM to
  do it), `onRequest` hooks are the natural place to resolve a token to its
  campaign scope before any handler runs, and structured logging ships with it —
  which the token-guess logging requirement wants anyway. On Express the same
  three jobs mean three more third-party packages. The cost is SSE, which needs
  `reply.raw` and care with the reply lifecycle rather than Express's plainer
  streaming; that is one well-commented module against three fewer dependencies.
- **SQLite via `better-sqlite3`**, single file, WAL, checked-in migrations, no
  ORM.
- **Server-Sent Events**, not WebSockets. The traffic is one-directional and SSE
  reconnects on its own.
- **Zero telemetry, zero third-party network calls at runtime.** All game data is
  bundled at build time.

## Data

`npm run build:data` normalizes 6,392 creatures and 1,221 hazards. The record
format and its edge cases are documented in `docs/`; the short version is that
every stat block field the app needs is resolved once, at build time, into a
plain value with no back-references, so the rules engine can transform one
functionally and hand back a new one.

Foundry's inline markup is resolved rather than displayed. `@Damage[]` and
`@Check[]` become span markers indexed into sibling `damage[]` / `checks[]`
arrays, so elite and weak adjustments rewrite a damage expression *inside* the
sentence instead of annotating around it. `@UUID[]` becomes an internal link
where the target is bundled locally, `@Template[]` and `@Localize[]` become
readable text.

Per-build diagnostics land in `data/build-report.json`: unresolved links, id
collisions, remaster supersessions, creatures with no type trait, and unmatched
page-table keys. Nothing is guessed at silently.

### Page numbers

The upstream data has none — its publication block is
`{ license, remaster, title, authors }` on every entry. Page references come from
the hand-maintained tables in `tools/build-data/pages/`, keyed by Off-Guard
entry id and merged at build time, with typos reported rather than ignored. The
tables ship empty; see that directory's README before adding to them.

## Licensing

Creature and hazard data is extracted from the
[Pathfinder Second Edition system for Foundry VTT](https://github.com/foundryvtt/pf2e)
and is ORC- or OGL-licensed per entry. The ORC license text, full attribution and
the Paizo compatibility statement are in `data/licenses/`. The application footer
renders the licence recorded on the entry being displayed — the packs mix ORC and
OGL 1.0a, so one blanket notice would be wrong.

Off-Guard is not affiliated with, endorsed, sponsored or approved by Paizo Inc.
