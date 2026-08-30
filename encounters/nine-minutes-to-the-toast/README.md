# Nine Minutes to the Toast

Everything for the one-shot, in one folder. Level 12, three PCs, roughly four hours.

```
nine-minutes-to-the-toast.md      the adventure — the reference
run-script.md                     beat by beat, with read-aloud text
discord-blurb.txt                 the player-facing post (character creation)
01..05-*.json                     encounter imports for Off-Guard
import-fidelity.patch             already applied; kept for reference
loop-console/                     the original standalone module (reference only)
```

## To import

Five files, one per encounter, in Off-Guard's own export format
(`offGuardEncounter: 1`). Import each from the encounter builder.

| File | Encounter | XP | Band |
|---|---|---|---|
| `01-the-aspic.json` | The Aspic | 30 | Trivial |
| `02-the-cellar-hestia.json` | The Cellar — Great-Aunt Hestia | 30 | Trivial |
| `03-the-cold-room.json` | The Cold Room — the parent | 60 | Moderate |
| `04-the-toast-qazrahin.json` | The Toast — Qazrahin the Fastidious | 90 | Severe |
| `05-optional-the-kitchen.json` | Optional — The Kitchen | 40 | Low |

Every creature id was checked against `data/index.json`, and every total was
priced by running `priceEncounter` from `src/rules/index.js` directly, not by
hand. Great-Aunt Hestia is `ghost-mage` with `adjustment: "elite"`, which the
rules engine resolves to Creature 11.

Each file sets `partyLevelOverride: 12` and `partySizeOverride: 3` so the budget
prices against this one-shot's party rather than a campaign panel with no sheets
in it.

**`import-fidelity.patch` is already applied** to
`public/assets/js/gm/actions.js`. Before it, `importEncounter` forwarded only
name, notes, terrain, lighting and treasure, silently dropping `adventure`,
`chapter`, `sortOrder` and both party overrides. Export now emits them too, so
encounters round-trip. The full suite passed after applying: 660 tests, 32 files.

Worth knowing: `importEncounter` and `exportEncounter` still have no test
coverage. That is why the dropped fields went unnoticed.

## To run it

The console is **built into Off-Guard** as its own tab: press `L`, or
`#/campaign/<id>/loop`. State lives on the server, so prepping on the laptop and
running from the desk machine is the same run.

`nine-minutes-to-the-toast.md` is the adventure itself. That is the thing you
read to run the session; the console is for the bookkeeping the text cannot do.

### What was added to the app

```
migrations/005_loop_console.sql          one row per campaign per adventure
src/shared/loop.js                       what a reset keeps -- shared, so both
                                         sides answer it the same way
src/server/store/loop.js                 persistence and scope
src/server/routes/gm/loop.js             GET/PUT/DELETE, campaign-scoped
public/assets/js/gm/views/loop.js        the view
public/assets/js/gm/adventures/           adventure definitions (pure data)
tests/shared/loop.test.js                the reset rule
tests/server/loop.test.js                the API, including isolation
```

Modified: `routes/gm/index.js`, `gm/{actions,api,main,shortcuts,state}.js`,
`css/{base,gm}.css`. `base.css` gained a `.btn--danger` variant, which the
application did not have despite every destructive action being undoable.

To run a different looping adventure, drop a file beside `nine-minutes.js` and
point the tab at it. The console knows about loops, faults and influence, and
nothing about wine.

`loop-console/` in this folder is the original standalone version, kept only as
a reference. It is not what the app runs.

## Re-verifying the encounter math

The script that priced these files is not kept here. It loads each file,
resolves creature ids against `data/creatures/`, applies `scaleCreature` then
`adjustCreature` in that order — the same order `present()` uses in
`src/server/routes/gm/catalogue.js` — and asserts the XP total and difficulty
band. Worth folding into `tests/` as a fixture if you keep authoring encounters
as files.
