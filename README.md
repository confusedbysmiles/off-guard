# Off-Guard

A self-hosted Pathfinder Second Edition table application: a GM dashboard, a
persistent character sheet for each player, and a shared read-only initiative
screen the whole table can watch. Built to run at a live table on a laptop, a
phone and a TV at the same time.

Multiple concurrent campaigns are first-class. A character belongs to exactly
one campaign; an encounter belongs to one campaign but can be copied to another;
creature data, reference tables and homebrew are global.

**Status: complete, and ready to deploy.** 524 unit tests and 43 end-to-end
tests, run at a host root and at a subdirectory. See
[deploy/GOING-LIVE.md](deploy/GOING-LIVE.md).

| # | Milestone | State |
|---|-----------|-------|
| 1 | Data pipeline, normalized creature format, inline-markup resolver | done |
| 2 | Rules engine + tests | done |
| 3 | Server, schema, migrations, token access, campaign-scoped API | done |
| 4 | Player character sheet, Pathbuilder import | done |
| 5 | GM dashboard: campaigns, party panel, encounter builder, XP budget | done |
| 6 | Initiative tracker | done |
| 7 | Shared screen over SSE | done |
| 8 | Reference drawer, dice roller, Recall Knowledge helper | done |
| 9 | Deployment, accessibility and security pass | done |

## Running it

```bash
npm install
npm test             # no data build required
npm run mint-gm      # prints your GM link, once
npm start            # http://127.0.0.1:8787

npm run build:data    # ~7 minutes on a cold cache, ~6 seconds after
npm run build:tables     # regenerates src/rules/tables/ from the pinned checkout
npm run build:reference  # regenerates data/reference.json, which is checked in
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

**Tokens are stored hashed.** The database holds the SHA-256 of each link and
never the link itself, so a copied database file — a backup, a stray WAL, a
support dump — is a list of what exists rather than a set of working keys.

A plain SHA-256, deliberately, and not bcrypt or argon2. Those exist to make
guessing expensive when the secret is a human-chosen password with perhaps 30
bits behind it. These tokens are 128 bits from `randomBytes`: there is no
dictionary, no reuse and no shortcut, so a slow hash would buy nothing and would
cost a measurable delay on every request, including every SSE reconnect.

The cost of this, stated plainly: **a link can be shown once and never again.**
It appears in the response that mints or rotates it, and after that the only way
to give a player their link back is to rotate it and hand them a new one.
`GET .../tokens` lists what links exist and what each is for, marked
`retrievable: false`, so no interface can be written against a field that will
always be absent.

The schema enforces scoping with CHECK constraints, so a bug in application code
cannot produce a character token with no campaign or a GM token bound to one.

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
| `conditions.js` — what a turn boundary applies | RAW where the rules state it plainly; a prompt everywhere else |
| `dice.js` — expressions, halving, doubling | RAW for halving and doubling (Player Core, Doubling and Halving Damage); the expression syntax is this application's, and deliberately small |
| `scale.js` — arbitrary level scaling | **Not RAW** — no printed operation moves a creature between levels — but built from the printed creature-building tables, GM Core pp. 114–121. Labelled an approximation wherever it surfaces |

The lookup tables in `src/rules/tables/` are generated by `npm run build:tables`
and checked in — the engine has to run in a browser with no data build behind it,
and `npm test` must not require one. The DC, encounter and creature-identification
tables are extracted from the GM Screen journal in the pinned checkout and carry
their GM Core page citation.

The creature-building tables are different, because they are printed text that
is in no bundled data. `tools/build-tables/extract-gm-core.py` transcribes the
nine of them — attribute modifiers, Perception, skills, AC, saves, HP, attack,
damage, spell DC — out of the book's own PDF into
`tools/build-tables/gm-core-creature-building.json`, which is checked in; the
PDF is not, and never will be. The extractor refuses a printing whose folios do
not match the citations, and requires every table to arrive as levels −1 through
24 with no gaps, so a misread cell shifts the columns and stops the run instead
of becoming one wrong number in a stat block. `npm run build:tables` then prints
the printed *moderate* column beside the median of the 6,363 bundled creatures:
they agree to within 2 at every level, which is the cross-check that two
independent sources give you for free.

This table used to be *fitted* — those medians, one column where the book has
four or five. It tracked moderate closely, which is why it was usable, but it
could not tell an extreme statistic from a terrible one, so a brute built on
extreme damage scaled at the same rate as a spellcaster's dagger.

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
the file, review the diff, apply what you accept. This is the path to use.

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

**The mapper is checked against a real export**, not only a synthetic one, and
that mattered. A real level 6 rogue found four things a hand-written fixture
never would have: a striking rune adds *dice* rather than a bonus, so every
weapon above about level 4 was importing at half its damage; sneak attack
arrives as free text in `extraDamage` and was being dropped; skill item bonuses
live in a `mods` object keyed by display name and were dropped silently; and the
sheet's traits field is `traitsText`, so the array the mapper emitted was never
rendered at all. `tests/fixtures/pathbuilder/rogue-6.json` is that export with
its identifying fields replaced — the mechanical shape is what the mapper reads,
and a player's character is not this repository's to keep.

What Pathbuilder does not export is said out loud rather than guessed at. A
shield's AC has no field on the sheet; proficiency in a *specific* weapon has
nowhere to go; and weapon traits are absent entirely, so whether Strength
applies to a given weapon's damage is a judgement the import cannot make. Each
of those produces a warning on the confirmation screen, and the last one only
when it could actually be hiding something — a character with a positive
Strength modifier and no damage bonus on any weapon.

## The GM dashboard

`/gm/<token>`, one token, every campaign. Dense and keyboard-driven, built for a
laptop at a table.

The campaign switcher is `C`; `1`–`9` jump straight to a campaign; `T`, `I`, `E`
and `A` switch between the party, initiative, the encounter builder and the
cross-campaign view; `R`, `D` and `K` open the drawer on the reference, the dice
and Recall Knowledge.
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

**The Setup tab (`S`) is everything about a campaign that is not a fight**: its
name, adventure, chapter, party level, next session and accent colour; the
roster, and adding to it; the links; and the session log. All of it had an API
from milestone 3 and no interface until milestone 9, which meant setting an
accent colour meant curl — a poor answer for the one feature the whole
multi-campaign design rests on.

**Links are made and unmade there.** One shared-screen link per
campaign, one per player, and your own. Nothing there can show you a link that
already exists — only its hash is stored — so a fresh one is shown once, large,
with a copy button and a sentence saying it will not be shown again. Rotating a
link kills the old one on the next request. Rotating your own signs this tab out
immediately, so the new link is shown first and the dialog cannot be dismissed
into a dashboard that no longer works.

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

Each row carries the stat block, Recall Knowledge, persistent damage, conditions,
the shared-screen eye and — for a player character — their hero points, because a
hero point is spent out loud and the GM is the one keeping count. Persistent
damage added here is what the end-of-turn prompt then offers to roll: the prompt
has a **Roll** button that puts those dice in the campaign's log and on the
shared screen, since the players watched the bleed start and should watch it
land.

## The drawer

`R`, `D` and `K` from anywhere on the dashboard. One panel on the right holding
the three things a GM reaches for mid-sentence, and deliberately not a modal:
the dashboard gives up the width rather than sitting underneath, so the
condition text can be read *while* the condition is applied to the goblin on the
row behind.

**Reference.** One search field over 132 bundled tables and actions plus all 43
conditions. The tables come from the GM Screen journal in the pinned checkout
and every one carries its printed page citation; the actions come from the
action packs and carry their action cost, traits and full text. Conditions are
*not* in the bundled corpus — they come from `src/rules/tables/conditions.js`,
the same table the initiative tracker applies, so what a GM reads out and what
the tracker acts on cannot drift apart.

`@UUID[]` links inside that text resolve inside the drawer: Demoralize links to
Frightened, Track links to Travel Speed. A link to a creature opens the stat
block instead, and a link to something not bundled says so rather than doing
nothing. The level-DC calculator is pinned to the top, because "what's the DC
for a level 7 rare thing" is the question a reference gets asked most and
reading it off a table means finding the row and then remembering the rarity
adjustment.

**Dice.** `2d6+3`, `1d20+9`, and `2d20kh1` for a fortune effect. Nothing more
elaborate: no exploding dice, no reroll syntax, no arithmetic beyond adding and
subtracting terms, because each of those would be a rule this application had
invented. Halving rounds down and doubling doubles the total rather than each
die, both from the rules engine.

The roll happens on the server. That is not ceremony — an open roll appears on
the shared screen, and the only way for the laptop and the television to agree
is for one process to roll once. **A secret roll is dropped from the shared
screen's payload entirely**, not sent with a flag, and a halved or doubled total
inherits the secrecy of the roll it came from: a doubled total appearing while
its secret parent did not would give the parent away.

**Recall Knowledge.** Which skills identify a creature and what the DC is are
rules and come from the engine. What a success actually tells the player is not:
the printed guidance is "a well-known attribute, and something more subtle on a
critical success", with no table of which number comes out on which degree. So
the helper lists the creature's facts in a sensible order, says on screen that
the order is this application's convenience rather than a rule, and lets the GM
reveal them one at a time. A revealed fact goes straight to the shared screen,
which is the point: the player who made the check should not have to write the
number down while five other people are talking.

The stat block it reads is the *adjusted* one stored on the combatant — elite,
weak or scaled — because that is the creature the party is actually fighting.

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

Open dice rolls appear in a strip along the bottom, newest first, so the room can
see what was rolled without the GM reading it out. Revealed Recall Knowledge
facts appear as chips on the creature they are about.

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

### Reordering

Initiative rows, encounters in a campaign, and creatures within an encounter all
reorder the same way, through `public/assets/js/lib/reorder.js`. Dragging is the
obvious gesture with a mouse and completely unavailable from a keyboard, so the
handle also takes Arrow Up and Arrow Down.

The keyboard path is worth its dozen lines twice over. The first version
restored focus on the next animation frame, which looks right and is not — the
save re-renders the list *after* that, focus falls to the body, and moving one
item two places means finding the handle again in between. Focus is now restored
by identity once the save has resolved, so an item can be walked to where it
belongs.

### Accessibility

Checked rather than asserted. `e2e/accessibility.spec.js` walks all three
surfaces and fails on an interactive element with no accessible name, on a
placeholder used as a label, on a missing or duplicated level-one heading, and
on the drawer's tabs if they stop behaving like tabs. `npm run check:contrast`
walks the design tokens and fails on any ink/ground pair below WCAG AA, in dark,
in light-by-toggle and in light-by-system.

Writing those found three things that no amount of looking at the screen would
have: the dashboard had no `<h1>` at all, the campaign switcher was marked up as
a `listbox` with `option` children and implemented none of the arrow-key
behaviour that promises, and the drawer's tabs were `role="tab"` in name only.
The switcher is now what it always was — a labelled group of buttons — and the
drawer's tabs got the roving tabindex, `aria-controls`, arrow keys and
`tabpanel` that the role was claiming.

Everything else was already there and stayed: focus is visible and never
removed, `prefers-reduced-motion` collapses every transition, every icon button
carries an `sr-only` label, and the shared screen announces turn changes through
one polite live region while the order itself is not one — a creature four rows
down losing hit points should not interrupt a reader mid-sentence.

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

### The reference corpus

`npm run build:reference` writes `data/reference.json`, which is **checked in**,
unlike the creature catalogue. The drawer is what a GM opens when a player asks
what Demoralize does, and it should not be the part of the application that
stops working because a data build has not been run. It is about 320 KB, which
is a fair trade for that.

Everything in it goes through the same markup resolver the creature build uses,
so `@UUID[]` becomes a working internal link and every attribute is stripped —
including the `style` the journal uses for column alignment, which the
Content-Security-Policy would refuse anyway.

### Page numbers

The upstream data has none — its publication block is
`{ license, remaster, title, authors }` on every entry. Page references come from
the tables in `tools/build-data/pages/`, keyed by Off-Guard entry id and merged
at build time, with keys that match no entry reported rather than ignored.

**2,066 of them are extracted from Paizo's own PDFs** by
`tools/build-pages/extract.py`, across eighteen books — Monster Core 98%,
Monster Core 2 99%, NPC Core 99%, Bestiary 1 100%, Bestiary 2 97%, Bestiary 3
92%, Book of the Dead 98%, Howl of the Wild 99%, Rage of Elements 94%, GM Core's
hazards 97%, Battlecry 91%, and the rest. That tool is local and one-off: it
needs PDFs that are not in this repository and never will be, it is not wired
into `npm run build:data`, and nothing in the application depends on it. Its
output is checked in, and that is what the build reads.

Four things make those numbers trustworthy rather than plausible:

1. Where a book has a bookmark outline, the numbers come from it, because that
   is the book's own statement about where its contents are.
2. Where it has none — NPC Core has no outline at all, and several books
   bookmark only their chapters — the stat-block titles are read off the pages
   as *display type*: a run of text whose size matches the run beside it reading
   "CREATURE 4". Requiring the pair is what makes it safe. A name on its own
   appears in prose throughout a book; a name set at title size next to its own
   printed level is the top of an entry.
3. The printed page number is read off the pages rather than assumed to equal
   the PDF index, and the offset is *tested* rather than voted for: candidates
   are nominated by how often `index - number` recurs, and the answer is the one
   actually printed on nine sampled pages in ten. A plurality was not enough —
   Bestiary 1 renders facing pages, so half its sheets carry two folios and the
   true offset led the wrong one only 16 votes to 10, which is why that book
   used to be skipped and is now at 100%.
4. Every match is verified, and the two routes verify differently. A bookmark is
   checked against the page's text: the creature's whole name has to be on the
   page it points at. An earlier version accepted the last word alone, which
   quietly verified Conspirator Dragon against the Adamantine Dragon's page,
   because "dragon" matches every dragon in the book. A display heading is
   checked against the catalogue instead: the level printed beside the name has
   to be the level the catalogue records.

Everything failing any of those is left out, and `null` renders as "no page
recorded" — honest, where a wrong number sends someone flipping through the
wrong chapter mid-session. Names are compared whole and exactly, so NPC Core's
"ORC AGRICULTURALIST" is not matched to the catalogue's "Orc Agriculturist" and
stays without a page. The remainder are entries in books nobody here has a PDF
of, almost all of them adventure paths; see
`tools/build-data/pages/README.md` before adding to them by hand.

## Deploying it

Two supported shapes, and the browser needs no configuration for either.

**Through a Cloudflare Tunnel**, which is the shape
[deploy/GOING-LIVE.md](deploy/GOING-LIVE.md) walks through end to end:
`deploy/macos/com.drseim.off-guard.plist` runs it under launchd and
`deploy/cloudflared/config.yml` connects it outbound to a hostname. Nothing
listens on a public port, there is no port forwarding and no VPS.

That means a subdomain rather than `drseim.com/off-guard`: a tunnel becomes the
origin for a whole hostname, and pointing `www` at it would take the GitHub
Pages site with it. Splitting one hostname across two origins needs a Cloudflare
Worker in front of both. The application supports either — this is a deployment
choice, and the subdomain is the cheap one.

**As a service.** `deploy/off-guard.service` is a systemd unit: a dedicated
user, `ProtectSystem=strict`, one writable path, an empty capability bounding
set and a `@system-service` syscall filter. It binds loopback and expects nginx
in front, because the token is in the URL and a URL over plain HTTP is a
postcard.

**In a container.** `docker compose up -d`, then
`docker compose exec off-guard node tools/mint-gm-token.js` for the GM link.
The image is two stages so the C++ toolchain that builds `better-sqlite3` is
not in the image that runs; the container is read-only apart from the database
volume, drops all capabilities, and publishes only to `127.0.0.1`.

*Not verified.* The Dockerfile and compose file are written and every path they
reference is checked, but no image has been built — there is no Docker on the
machine this was developed on. Treat the systemd path as the tested one.

**Serving from a subdirectory.** The brief puts this at `drseim.com/off-guard`
rather than on a host of its own. Set `OFF_GUARD_BASE_PATH=/off-guard` and use
`deploy/nginx.conf`, which forwards the prefix rather than stripping it — one
source of truth for the URL shape instead of two that can drift.

Nothing in the browser changes, and there is no setting to keep in step. Every
page is exactly two segments deep (`<mount>/gm/<token>`), so stylesheets and
module imports reach their targets with `../` and the client works its own
mount point out from `location.pathname`. A root-absolute `href` would work
perfectly at a host root and 404 silently for every player the moment the
application moved; a test asserts there are none.

Two things in the nginx snippet are load-bearing rather than boilerplate:

- **`proxy_buffering off`.** The shared screen is one long-lived response fed a
  few hundred bytes at a time. Buffered, the television updates in batches
  minutes apart, which looks exactly like the application being broken.
- **`X-Forwarded-For`.** The defence against token guessing counts failures per
  client address. Without it every attempt looks like it came from nginx, and
  one guesser locks out the whole table.

The access log is turned off for this location. An access log line here is a
credential written to disk in cleartext, rotated, and often shipped somewhere.

### Backing it up

The database is the whole application state: every campaign, every sheet, every
token hash. **It is not one file.** WAL mode means recent writes live in
`off-guard.sqlite-wal` until a checkpoint, so `cp off-guard.sqlite backup.sqlite`
silently loses them — which is how, while testing the token migration, a copy
came back with one token in it instead of three.

Use SQLite's own backup, which is consistent against a running server:

```bash
sqlite3 /var/lib/off-guard/off-guard.sqlite ".backup '/backups/off-guard.sqlite'"
```

## Licensing

Creature and hazard data is extracted from the
[Pathfinder Second Edition system for Foundry VTT](https://github.com/foundryvtt/pf2e)
and is ORC- or OGL-licensed per entry. The ORC license text, full attribution and
the Paizo compatibility statement are in `data/licenses/`. The application footer
renders the licence recorded on the entry being displayed — the packs mix ORC and
OGL 1.0a, so one blanket notice would be wrong.

Off-Guard is not affiliated with, endorsed, sponsored or approved by Paizo Inc.
