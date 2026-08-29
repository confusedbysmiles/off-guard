# Off-Guard

A self-hosted Pathfinder Second Edition table application: a GM dashboard, a
persistent character sheet for each player, and a shared read-only initiative
screen the whole table can watch. Built to run at a live table on a laptop, a
phone and a TV at the same time.

Multiple concurrent campaigns are first-class. A character belongs to exactly
one campaign; an encounter belongs to one campaign but can be copied to another;
creature data, reference tables and homebrew are global.

**Status: milestone 3 of 9.** Data pipeline, rules engine, and a running
campaign-scoped API. There is no interface yet.

| # | Milestone | State |
|---|-----------|-------|
| 1 | Data pipeline, normalized creature format, inline-markup resolver | done |
| 2 | Rules engine + tests | done |
| 3 | Server, schema, migrations, token access, campaign-scoped API | done |
| 4 | Player character sheet, Pathbuilder import | next |
| 5 | GM dashboard: campaigns, party panel, encounter builder, XP budget | |
| 6 | Initiative tracker | |
| 7 | Shared screen over SSE | |
| 8 | Reference drawer, dice roller, Recall Knowledge helper | |
| 9 | Deployment, accessibility and security pass | |

## Running it

```bash
npm install
npm test             # no data build required
npm run mint-gm      # prints your GM link, once
npm start            # http://127.0.0.1:8787

npm run build:data   # ~7 minutes on a cold cache, ~6 seconds after
npm run build:tables # regenerates src/rules/tables/ from the pinned checkout
```

Configuration is documented in `.env.example`; every value has a working
default. Migrations in `migrations/` run at startup, each in its own
transaction.

## Access

There are no accounts and no passwords. Access is by unguessable token in the
URL — 128 bits, rendered as 26 characters of Crockford base32, which drops I, L,
O and U so a link can be read aloud across a table and typed back without
ambiguity.

| Link | Reaches |
|------|---------|
| `/gm/<token>` | every campaign. One token, minted by `npm run mint-gm`, never through the API |
| `/c/<token>` | one character in one campaign, read/write |
| `/table/<token>` | one campaign's shared screen, read-only |

The rule the model rests on: **a campaign id that arrives from the client is
never trusted.** Every store function takes the scope resolved from the URL
token, and a campaign id that does not match it is refused rather than quietly
replaced with the caller's own — silent redirection would hide a bug and turn a
probe into a request that merely returned something else. Campaign filters are
in the SQL, so a character id from another campaign returns no row at all rather
than a row that is checked afterwards.

Malformed, unknown, revoked and wrong-kind tokens all produce the same 404 after
the same work, so none can be told apart from outside. Failures are recorded with
a four-character fingerprint, never the token; Fastify's own request logging is
off, because its log lines carry the URL and the URL is the credential. Rate
limiting is per IP. Rotation revokes immediately and keeps the old row, so an
old log line still means something.

Tokens are stored in the clear. They protect data that lives in the same SQLite
file, so hashing them would not raise the bar for anyone holding the file, and it
would stop the dashboard re-showing a player their link — which is a real
workflow, and rotation is the answer to compromise. The schema enforces scoping
with CHECK constraints, so a bug in application code cannot produce a character
token with no campaign or a GM token bound to one.

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

## The rules engine

`src/rules/` is dependency-free and environment-free — no Node APIs, no DOM, no
imports outside `src/`. The server and the browser both use it, and nothing else
in the application does arithmetic on a stat block or a character sheet. A test
enforces both of those claims.

Creature transforms are non-destructive: `adjustCreature` and `scaleCreature`
return a new record and never touch the one they were given, so toggling elite
off is a re-render rather than an undo.

What is rules as written and what is not:

| Module | Status |
|--------|--------|
| `adjust.js` — elite and weak | RAW. Monster Core, Elite and Weak Adjustments |
| `encounter.js` — XP budget | RAW. GM Core pg. 75 |
| `dc.js` — DCs by level, simple DCs, adjustments | RAW. GM Core pg. 53 |
| `proficiency.js` — character statistics | RAW. Player Core, Proficiency |
| `recall-knowledge.js` | RAW for skills and DC; the order facts are revealed in is this application's convenience, and says so |
| `scale.js` — arbitrary level scaling | **Not RAW.** An approximation, labelled as one wherever it surfaces |

The lookup tables in `src/rules/tables/` are generated by `npm run build:tables`
and checked in — the engine has to run in a browser with no data build behind it,
and `npm test` must not require one. The DC, encounter and creature-identification
tables are extracted from the GM Screen journal in the pinned checkout and carry
their GM Core page citation. The level-scaling table is different: the GM Core
creature-building tables are printed text that is not in any bundled data, so
that one table is *fitted* from the median of each statistic across the 6,392
bundled creatures. It reproduces the printed "moderate" column wherever that can
be checked by hand, but it describes what Paizo published rather than what the
tables prescribe, which is why anything built on it is labelled an approximation.
Replacing it with transcribed values needs no code change.

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
