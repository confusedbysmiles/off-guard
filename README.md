# Off-Guard

A self-hosted Pathfinder Second Edition table application: a GM dashboard, a
persistent character sheet for each player, and a shared read-only initiative
screen the whole table can watch. Built to run at a live table on a laptop, a
phone and a TV at the same time.

Multiple concurrent campaigns are first-class. A character belongs to exactly
one campaign; an encounter belongs to one campaign but can be copied to another;
creature data, reference tables and homebrew are global.

**Status: milestone 7 of 9.** All three surfaces work, and the shared screen
updates live.

| # | Milestone | State |
|---|-----------|-------|
| 1 | Data pipeline, normalized creature format, inline-markup resolver | done |
| 2 | Rules engine + tests | done |
| 3 | Server, schema, migrations, token access, campaign-scoped API | done |
| 4 | Player character sheet, Pathbuilder import | done |
| 5 | GM dashboard: campaigns, party panel, encounter builder, XP budget | done |
| 6 | Initiative tracker | done |
| 7 | Shared screen over SSE | done |
| 8 | Reference drawer, dice roller, Recall Knowledge helper | next |
| 9 | Deployment, accessibility and security pass | |

## Running it

```bash
npm install
npm test             # no data build required
npm run mint-gm      # prints your GM link, once
npm start            # http://127.0.0.1:8787

npm run build:data    # ~7 minutes on a cold cache, ~6 seconds after
npm run build:tables  # regenerates src/rules/tables/ from the pinned checkout
npm run build:fonts   # refetches Jost into public/assets/fonts/
npm run check:contrast
npm run test:e2e      # Playwright, three surfaces, needs `npx playwright install chromium`
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

## The character sheet

Mobile first, because it is used one-handed on a phone while holding dice.
Every write lands locally before the network is touched: the store applies the
change in memory, mirrors it into `localStorage`, and only then queues a
debounced request. Losing signal, closing the tab and reloading offline all keep
what was typed, and the queue is replayed on top of the server's copy when the
connection comes back rather than being discarded by the reload.

Fields are versioned individually, so the GM pushing a condition and a player
typing a note do not collide — different paths, both applied. A genuine
same-path conflict adopts the server's value, because that is the one the rest
of the table can see, and hands the local value back so the player can put it
back deliberately instead of watching it vanish.

Every derived number is computed by the rules engine and every one accepts a
manual override that shows a marker and keeps the computed value visible in the
tooltip. PF2e has more exceptions than a calculator can hold, and a locked field
is worse than a spreadsheet.

The browser loads `src/rules/` directly, served at `/engine/`. Copying it into
`public/` would be a build step, and two copies of the arithmetic is exactly what
the engine exists to prevent.

### Pathbuilder import

Two paths, and only one of them is reliable.

**The JSON export file works, always, offline.** Export from Pathbuilder, upload
the file, review the diff, apply what you accept.

**By build id, probably not.** `pathbuilder2e.com/json.php?id=…` sits behind
Cloudflare's bot protection, which answers a server-side request with a
challenge page rather than JSON — verified, it returns 403. Off-Guard does not
try to defeat that: it identifies itself honestly as Off-Guard, and when the
answer is not a build it says so and points at the export file. Set
`OFF_GUARD_PATHBUILDER_FETCH=off` to remove the outbound request entirely. It is
the application's only one.

A re-import at level-up is safe by construction. The mapper produces a fixed set
of paths and nothing else, so the free-text feats, features, reactions, items
and notes sections are invisible to it; play state — current and temporary hit
points, conditions, hero points, spent slots and focus — is produced but never
proposed, because levelling up should not heal the character.

## The GM dashboard

`/gm/<token>`, one token, every campaign. Dense and keyboard-driven, built for a
laptop at a table.

The campaign switcher is `C`; `1`–`9` jump straight to a campaign; `T`, `E` and
`A` switch between the table, the encounter builder and the cross-campaign view.
Each campaign's accent colour runs through the whole chrome — the top border, the
switcher swatch, every panel heading and the left edge of every party card —
because the failure this is designed against is applying damage to the wrong
table's goblin at eleven at night, and a colour in one corner does not prevent
that.

**The party panel is live from the sheets.** Every AC, save and skill total is
computed by the rules engine from what the player last typed, so the panel and
the sheet cannot disagree. Sheets are flagged when nobody has touched them for
three weeks, when their level trails the party, or when they have no hit points
recorded.

**Encounter budget comes from the sheets too.** Party size is however many
characters exist; party level is the *median of the levels on the sheets*, not
the campaign's `partyLevel` field — a campaign whose level was never updated
should not silently price encounters against a number nobody is playing. The
panel says when the two disagree, and an encounter can still override both for a
one-shot.

Creatures are priced at their *adjusted* level, so an elite goblin costs what a
level 1 creature costs. A creature more than four levels from the party is not
priced at all: the encounter table does not extend there, so the builder reports
which creature is off the table and refuses to show a difficulty, rather than
showing a total that quietly omits something.

Search runs on the server — the index is 2.6 MB across ~7,600 rows, and shipping
that to a browser so the GM can find a goblin would be worse than a request.
It is a linear scan, measured at about 2 ms, which is under a keystroke and
readable in two years' time. A clone that has not run `npm run build:data` still
starts; the dashboard says the catalogue is missing rather than failing in a way
that looks like a bug.

## The initiative tracker

`I` on the dashboard. Space or `N` advances the turn, `P` steps back.

Starting a fight adds the party and rolls initiative for the creatures. The
creature rolls happen on the server, because the roll needs the stat block and a
modifier sent up from the browser would let a mistake in the interface change the
numbers. **Player initiative is deliberately left blank** — the rules have the
player roll it, and inventing a number for someone else's character is the one
thing a tracker must not do. Creatures start hidden from the shared screen: a
fight the players walk into should not be listed before they see it.

Sorting is by initiative, descending. **Ties are not broken.** The rules give no
tiebreak, so tied combatants keep the order they are in and the GM drags them;
a re-sort does not undo the drag.

The rule the tracker is built around: **apply what the rules state plainly, and
ask about everything else.** Checked against the printed text of every condition
in the pinned checkout, exactly one decreases on its own at the end of a turn —
frightened. Doomed, drained and fatigued key off a night's rest; stunned keys off
actions actually lost. So at a turn boundary the tracker decrements frightened
and then shows a list of what it did *not* decide — persistent damage with its
flat check, stunned, a dying combatant's recovery check — each quoting the
sentence the rule comes from.

Damage takes a negative number to heal, which is what a GM actually types.
Temporary hit points are spent first and not healed back; dropping to 0 sets
dying to 1 plus the wounded value; damage while dying raises it; dying 4 is
reported as death; and being healed out of dying raises the wounded value, which
is easy to forget at a table and easier to forget in code.

## The shared screen

`/table/<token>`, one per campaign, read-only. Nothing on the page can write and
the token cannot write either — every mutating store function refuses a table
scope, so the page having no controls is belt and braces rather than the only
guard. A Playwright test asserts the page contains no inputs at all.

Player characters show their numbers; the party knows its own. Creatures show a
descriptor — Unharmed through Near Death — unless the GM flips that one creature
to numeric. **Hidden combatants are absent, not redacted**: they are filtered out
of the payload before it leaves the server, and the active-turn index is
recomputed against the filtered list, so neither a gap in the order nor a jump in
the highlight can betray that something is there.

Updates arrive over Server-Sent Events. Every event carries the whole view rather
than a delta — it is a few hundred bytes, and it removes the entire class of bug
where a client drifts from the server after a dropped event. The connection state
is always on screen, because a screen cast to a television that has quietly
stopped updating is worse than one that says so. A turn change fires an
`aria-live` announcement; the list itself is not a live region, so a creature four
rows down losing hit points does not interrupt a screen reader mid-sentence.

Two densities from one stylesheet: `tv`, which is the default because that is
usually what the link is for, and `phone`.

Player sheets are on the same stream. A condition the GM pushes appears on the
player's phone without a refresh, and anything the player has queued locally wins
over the push — a condition must not overwrite a sentence being typed.

## Look

Dark by default, light on toggle, and `prefers-color-scheme` respected in both
directions. `npm run check:contrast` reads the tokens out of the stylesheet and
checks every ink-on-ground pair the interface uses against WCAG AA in all three
states (dark, light by toggle, light by system preference); it exits non-zero on
a failure. Jost is self-hosted as two variable woff2 files, latin subset, 56 KB
total, fetched once by `npm run build:fonts` and committed.

There is no emoji anywhere in the interface. Icons are SVG paths on
`currentColor`, so they follow the theme and a screen reader reads the button's
label rather than a Unicode character name.

The Content-Security-Policy has no `unsafe-inline`, which forbids `style`
attributes as well as `<style>` blocks — including ones set from script. The
hit-point bar is therefore a real `<progress>` element and the per-campaign
accent colour is applied through a constructed stylesheet. The page loads with
zero CSP violations, which is what makes a violation report worth reading.

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
