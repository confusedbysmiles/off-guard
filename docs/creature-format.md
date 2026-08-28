# The normalized creature record

One JSON file per pack under `data/creatures/`, plus `data/index.json` (one flat
search row per entry) and `data/traits.json` (trait vocabulary with counts).
Records are plain values with no back-references, so the rules engine can
transform one functionally and hand back a new one.

```
id, name, level, size{code,label}, rarity, traits[], creatureType
source{book, license, remaster, pack, tier, page}
perception{mod, senses[{type,acuity,range,label}], sensesLabel, details}
languages{value[], details}
skills[{slug, label, mod, note, special[]}]
abilityMods{str, dex, con, int, wis, cha}
ac{value, details}
saves{fortitude, reflex, will: {mod, note}, allNote}
hp{max, details, regeneration, fastHealing, hardness}
immunities[]  weaknesses[]  resistances[]  derivedIwr{...}
speeds{land, other[], details, label}
items[{name, ref, quantity, equipped}]
strikes[{name, kind, mod, range, damage[{formula,type,category}], traits[], effects[], note}]
spellcasting[{name, kind, tradition, dc, attackMod, autoHeightenRank, ranks[{rank, slotsMax, spells[]}]}]
focus
abilities{passive[], action[], reaction[], free[]}
  each: {name, cost{type,count}, category, traits[], frequency, rechargeNote, text}
description{blurb, notes}
supersededBy?
```

## Rich text

Ability prose, strike notes and hazard routines are `RichText`:

```
{ html, text, damage[], checks[], links[] }
```

`html` contains `<span class="og-dmg" data-og-dmg="0">18d6 fire</span>` and
`<span class="og-chk" data-og-chk="0">DC 41 basic Reflex save</span>` markers
that index into the sibling arrays. This is the load-bearing decision in the
format: elite and weak adjustments must rewrite damage *inside* the sentence
("deals 18d6+4 fire damage in a 60-foot cone"), not annotate around it, and a
marker with a parsed structure beside it is the only way to do that without
re-parsing English at render time.

`@UUID[]` resolves to `<a class="og-ref" href="#/ref/<kind>/<id>">` when the
target is bundled locally, and to a marked-unresolved span otherwise (5 remain,
all journal pages outside the bundled packs). `@Template[]` and `@Localize[]`
resolve to text. Nothing raw reaches the screen.

## What the upstream data does not give us

Recorded here so nobody re-discovers them. Counts are from pinned commit
`8c8a688`.

**Page numbers do not exist.** The publication block is
`{license, remaster, title, authors}` on all 7,726 entries. `source.page` is
filled from `tools/build-data/pages/` by hand or left `null`.

**93 id collisions.** Several books print a creature called "Guard". The bare
slug goes to remaster core first (see `ID_PRIORITY` in `build.js`); losers are
pack-suffixed. Nothing is dropped.

**28 remaster supersessions.** Legacy Bestiary and Monster Core both ship e.g.
Barghest. Both records are kept and the legacy one carries `supersededBy`, so
search can rank or hide it without losing the pre-remaster stat block.

**67 creatures have no creature-type trait** — mostly humanoid NPCs and summons.
Listed in `data/build-report.json`; `creatureType` is `null` rather than guessed.

**Strikes carry no melee/ranged flag.** A strike is treated as ranged iff it has
a range increment, so thrown weapons appear under `ranged` only, where a printed
stat block would list them on both lines.

**Some IWR exists only as a Foundry rule element** evaluated against live actor
state. Mined into `derivedIwr`, kept separate from the printed lists so the stat
block can show where it came from.

**Stale spell attack modifiers.** Many remaster spellcasting entries carry an
attack modifier whose printed stat block has no spell attack roll. `0` is treated
as absent.

**Regeneration vs fast healing is ambiguous** in the free-text HP details. The
`FastHealing` rule element is preferred where present because it separates the
two and lists what deactivates it.

**Limited use is expressed two ways.** Elite and weak add ±4 damage rather than
±2 to abilities with limited uses or a frequency (Monster Core, Elite and Weak
Adjustments), but only 1,553 abilities carry a structured `system.frequency`
while 2,413 state the limit in prose alone ("can't use Pyre Breath again for 1d4
rounds"). Both survive normalization, as `frequency` and `rechargeNote`; the
prose matcher is deliberately conservative, since a false negative means the GM
decides while a false positive silently changes damage.
