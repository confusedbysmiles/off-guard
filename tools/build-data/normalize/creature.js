/**
 * Foundry NPC actor -> Off-Guard creature record.
 *
 * Everything the stat block needs is resolved here, once, at build time. The
 * result is a plain value with no back-references so the rules engine can
 * transform it functionally (elite/weak/level scaling) and hand back a new one.
 */
import { CREATURE_TYPE_TRAITS, packTier } from '../catalog.js';
import { slugify } from '../markup.js';
import {
  joinList, mineRuleElementIwr, normalizeImmunity, normalizeResistance,
  normalizeSense, normalizeWeakness, parseHpDetails, sizeName, titleCase, words,
} from './shared.js';

/** Item types that make up the printed "Items" line rather than a Strike. */
const INVENTORY_TYPES = new Set([
  'weapon', 'armor', 'shield', 'consumable', 'equipment', 'treasure', 'backpack', 'ammo', 'kit',
]);

const SAVE_KEYS = ['fortitude', 'reflex', 'will'];

/** Upstream `system.frequency`, e.g. `{ max: 1, per: 'round' }`. */
function normalizeFrequency(freq) {
  if (!freq || freq.max === undefined || freq.max === null) return null;
  return { max: freq.max, per: freq.per ?? null };
}

/**
 * Recharge stated in prose only: "can't use ... again for 1d4 rounds",
 * "once per day", "recharge 5-6". Deliberately conservative -- a false
 * negative just means the GM decides, a false positive silently changes
 * damage numbers.
 */
const RECHARGE_PATTERNS = [
  /can(?:'|’)?t\s+(?:use|do)\s+[^.]*?again\s+for\s+([^.,;]+)/i,
  /\bonce\s+per\s+(round|minute|hour|day|combat|encounter)\b/i,
  /\brecharge\s+([0-9]+(?:\s*[-–]\s*[0-9]+)?)/i,
];

function rechargeNote(text) {
  for (const re of RECHARGE_PATTERNS) {
    const m = re.exec(String(text ?? ''));
    if (m) return m[0].trim();
  }
  return null;
}

/** Action cost as printed: 1/2/3 actions, reaction, free action, or passive. */
function actionCost(system) {
  const type = system.actionType?.value ?? 'passive';
  const count = system.actions?.value ?? null;
  if (type === 'action') return { type: 'action', count: count ?? 1 };
  return { type, count: null };
}

function normalizeStrike(item, resolve, ctx) {
  const s = item.system;
  const damage = Object.values(s.damageRolls ?? {}).map((roll) => ({
    formula: roll.damage,
    type: roll.damageType,
    category: roll.category ?? null,
  }));
  const effects = [
    ...(s.attackEffects?.value ?? []),
    ...String(s.attackEffects?.custom ?? '').split(',').map((x) => x.trim()).filter(Boolean),
  ];
  const note = s.description?.value ? resolve(s.description.value, ctx) : null;
  return {
    name: item.name,
    // Foundry has no melee/ranged flag on NPC strikes: a Strike is ranged iff it
    // carries a range increment. Thrown weapons therefore land in "ranged" only,
    // where a printed stat block would list them on both lines.
    kind: s.range ? 'ranged' : 'melee',
    mod: s.bonus?.value ?? 0,
    range: s.range ? { increment: s.range.increment ?? null, max: s.range.max ?? null } : null,
    damage,
    traits: s.traits?.value ?? [],
    effects,
    note: note && note.text ? note : null,
  };
}

/**
 * Spellcasting.
 *
 * Spells bind to their entry through `system.location.value`, which holds the
 * entry's `_id`. Prepared entries list slots in `slots.slotN.prepared[]` (ids
 * repeat when a spell is prepared more than once); innate entries have no slots
 * and carry the cast rank in `location.heightenedLevel`; spontaneous entries use
 * `slots.slotN.max` for slots per rank with the spell list taken from the entry.
 */
function normalizeSpellcasting(items, resolve, level) {
  const entries = items.filter((i) => i.type === 'spellcastingEntry');
  if (!entries.length) return [];
  const spells = items.filter((i) => i.type === 'spell');
  const spellsById = new Map(spells.map((s) => [s._id, s]));

  return entries.map((entry) => {
    const s = entry.system;
    const kind = s.prepared?.value ?? 'prepared';
    const mine = spells.filter((sp) => sp.system.location?.value === entry._id);

    const describe = (spell, rank) => ({
      name: spell.name,
      ref: slugify(spell.name),
      rank,
      baseRank: spell.system.level?.value ?? null,
      cantrip: (spell.system.traits?.value ?? []).includes('cantrip'),
      uses: spell.system.location?.uses ?? null,
      signature: spell.system.location?.signature ?? false,
    });

    const byRank = new Map();
    const add = (rank, spell) => {
      if (!byRank.has(rank)) byRank.set(rank, { rank, slotsMax: null, spells: [] });
      byRank.get(rank).spells.push(spell);
    };

    if (kind === 'prepared') {
      for (const [slotKey, slot] of Object.entries(s.slots ?? {})) {
        const rank = Number(slotKey.replace('slot', ''));
        if (Number.isNaN(rank)) continue;
        if (!byRank.has(rank)) byRank.set(rank, { rank, slotsMax: slot.max ?? null, spells: [] });
        else byRank.get(rank).slotsMax = slot.max ?? null;
        for (const prepared of slot.prepared ?? []) {
          const spell = spellsById.get(prepared.id);
          if (spell) add(rank, describe(spell, rank));
        }
      }
    } else {
      for (const spell of mine) {
        const rank = spell.system.location?.heightenedLevel ?? spell.system.level?.value ?? 0;
        add(rank, describe(spell, rank));
      }
      for (const [slotKey, slot] of Object.entries(s.slots ?? {})) {
        const rank = Number(slotKey.replace('slot', ''));
        if (Number.isNaN(rank) || !byRank.has(rank)) continue;
        byRank.get(rank).slotsMax = slot.max ?? null;
      }
    }

    const attackMod = s.spelldc?.value ?? null;
    return {
      name: entry.name,
      kind,
      tradition: s.tradition?.value ?? null,
      dc: s.spelldc?.dc ?? null,
      // Upstream leaves a stale attack modifier on many remaster entries whose
      // printed stat block has no spell attack roll. Treat 0 as absent.
      attackMod: attackMod ? attackMod : null,
      autoHeightenRank: s.autoHeightenLevel?.value ?? null,
      description: s.description?.value ? resolve(s.description.value, { level }) : null,
      ranks: [...byRank.values()]
        .filter((r) => r.spells.length || r.slotsMax)
        .sort((a, b) => b.rank - a.rank),
    };
  });
}

export function normalizeCreature(doc, { pack, resolve, localize, id }) {
  const s = doc.system;
  const level = s.details?.level?.value ?? 0;
  const ctx = { level, rank: null, source: id };
  const items = doc.items ?? [];

  const traits = s.traits?.value ?? [];
  const hp = parseHpDetails(s.attributes?.hp?.details);
  const mined = mineRuleElementIwr(items);

  // The FastHealing rule element is more precise than the free-text HP details:
  // it separates regeneration from fast healing and lists what deactivates it.
  const healing = mined.fastHealing;
  const regeneration =
    healing?.type === 'regeneration'
      ? {
          amount: healing.amount,
          deactivatedBy: healing.deactivatedBy?.length
            ? joinList(healing.deactivatedBy.map(words), 'or')
            : hp.regeneration?.deactivatedBy ?? null,
        }
      : hp.regeneration;
  const fastHealing =
    healing && healing.type !== 'regeneration' ? healing.amount : hp.fastHealing;

  const senses = (s.perception?.senses ?? []).map((sense) => normalizeSense(sense));
  const otherSpeeds = (s.attributes?.speed?.otherSpeeds ?? []).map((sp) => ({
    type: sp.type,
    value: sp.value ?? null,
    label: `${words(sp.type).toLowerCase()} ${sp.value} feet`,
  }));

  const abilities = { passive: [], action: [], reaction: [], free: [] };
  for (const item of items) {
    if (item.type !== 'action') continue;
    const cost = actionCost(item.system);
    const text = resolve(item.system.description?.value ?? '', ctx);
    const entry = {
      name: item.name,
      cost,
      category: item.system.category ?? null,
      traits: item.system.traits?.value ?? [],
      // Elite/weak adds +4/-4 damage to abilities with limited uses or a
      // frequency (Monster Core, Elite and Weak Adjustments), so the two ways
      // a limit is expressed both have to survive normalization: a structured
      // `frequency` on the item, and a recharge stated only in prose.
      frequency: normalizeFrequency(item.system.frequency),
      rechargeNote: rechargeNote(text.text),
      text,
    };
    (abilities[cost.type] ?? abilities.passive).push(entry);
  }

  const inventory = items
    .filter((i) => INVENTORY_TYPES.has(i.type))
    .map((i) => ({
      name: i.name,
      ref: slugify(i.name),
      quantity: i.system.quantity ?? 1,
      equipped: i.system.equipped?.carryType ?? null,
    }));

  const publication = s.details?.publication ?? {};

  return {
    id,
    name: doc.name,
    level,
    size: { code: s.traits?.size?.value ?? null, label: sizeName(s.traits?.size?.value) },
    rarity: s.traits?.rarity ?? 'common',
    traits,
    creatureType: traits.find((t) => CREATURE_TYPE_TRAITS.includes(t)) ?? null,
    source: {
      book: publication.title || null,
      license: publication.license ?? null,
      remaster: publication.remaster ?? false,
      pack,
      tier: packTier(pack),
      // Foundry carries no page references. The field exists so a page can be
      // recorded by hand later without a migration.
      page: null,
    },
    perception: {
      mod: s.perception?.mod ?? 0,
      senses,
      sensesLabel: joinList(senses.map((x) => x.label)),
      details: s.perception?.details || null,
    },
    languages: {
      value: s.details?.languages?.value ?? [],
      details: s.details?.languages?.details || null,
    },
    skills: Object.entries(s.skills ?? {})
      .map(([key, value]) => ({
        slug: key,
        label: titleCase(key),
        mod: value.base ?? 0,
        note: value.note || null,
        special: (value.special ?? []).map((sp) => ({ label: sp.label, mod: sp.base })),
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    abilityMods: {
      str: s.abilities?.str?.mod ?? 0, dex: s.abilities?.dex?.mod ?? 0,
      con: s.abilities?.con?.mod ?? 0, int: s.abilities?.int?.mod ?? 0,
      wis: s.abilities?.wis?.mod ?? 0, cha: s.abilities?.cha?.mod ?? 0,
    },
    ac: { value: s.attributes?.ac?.value ?? 10, details: s.attributes?.ac?.details || null },
    saves: {
      ...Object.fromEntries(SAVE_KEYS.map((k) => [k, {
        mod: s.saves?.[k]?.value ?? 0,
        note: s.saves?.[k]?.saveDetail || null,
      }])),
      allNote: s.attributes?.allSaves?.value || null,
    },
    hp: {
      max: s.attributes?.hp?.max ?? 0,
      details: hp.text || null,
      regeneration,
      fastHealing,
      hardness: hp.hardness,
    },
    immunities: (s.attributes?.immunities ?? []).map((e) => normalizeImmunity(e, localize)),
    weaknesses: (s.attributes?.weaknesses ?? []).map((e) => normalizeWeakness(e, localize)),
    resistances: (s.attributes?.resistances ?? []).map((e) => normalizeResistance(e, localize)),
    // IWR that exists only as a rule element, kept separate so it is obvious
    // where it came from and can be shown with its source ability.
    derivedIwr: {
      resistances: mined.resistances.map((r) => ({ ...normalizeResistance(r, localize), source: r.source })),
      weaknesses: mined.weaknesses.map((w) => ({ ...normalizeWeakness(w, localize), source: w.source })),
      immunities: mined.immunities.map((i) => ({ ...normalizeImmunity(i, localize), source: i.source })),
    },
    speeds: {
      land: s.attributes?.speed?.value ?? null,
      other: otherSpeeds,
      details: s.attributes?.speed?.details || null,
      label: joinList([
        // A ghost has land speed 0 and fly 25: never print "Speed 0 feet".
        s.attributes?.speed?.value ? `${s.attributes.speed.value} feet` : null,
        ...otherSpeeds.map((x) => x.label),
      ], 'and'),
    },
    items: inventory,
    strikes: items.filter((i) => i.type === 'melee').map((i) => normalizeStrike(i, resolve, ctx)),
    spellcasting: normalizeSpellcasting(items, resolve, level),
    focus: s.resources?.focus
      ? { points: s.resources.focus.value ?? 0, pool: s.resources.focus.max ?? 0 }
      : null,
    abilities,
    description: {
      blurb: s.details?.blurb || null,
      notes: s.details?.publicNotes ? resolve(s.details.publicNotes, ctx) : null,
      gmNotes: s.details?.privateNotes ? resolve(s.details.privateNotes, ctx) : null,
    },
  };
}
