/**
 * Foundry hazard actor -> Off-Guard hazard record.
 *
 * Hazards are a genuinely different shape from creatures: hardness and a Stealth
 * DC instead of Perception, plus Disable, Reset and Routine entries. They also
 * cost XP differently — a complex hazard counts as a creature of its level, a
 * simple hazard as one-fifth that (GM Core, "Building Encounters") — which the
 * rules engine handles, not this file.
 */
import { packTier } from '../catalog.js';
import { slugify } from '../markup.js';
import {
  normalizeImmunity, normalizeResistance, normalizeWeakness, titleCase,
} from './shared.js';

function actionCost(system) {
  const type = system.actionType?.value ?? 'passive';
  const count = system.actions?.value ?? null;
  if (type === 'action') return { type: 'action', count: count ?? 1 };
  return { type, count: null };
}

export function normalizeHazard(doc, { pack, resolve, localize, id }) {
  const s = doc.system;
  const level = s.details?.level?.value ?? 0;
  const ctx = { level, rank: null, source: id };
  const items = doc.items ?? [];
  const publication = s.details?.publication ?? {};

  const abilities = { passive: [], action: [], reaction: [], free: [] };
  for (const item of items) {
    if (item.type !== 'action') continue;
    const cost = actionCost(item.system);
    (abilities[cost.type] ?? abilities.passive).push({
      name: item.name,
      cost,
      category: item.system.category ?? null,
      traits: item.system.traits?.value ?? [],
      text: resolve(item.system.description?.value ?? '', ctx),
    });
  }

  return {
    id,
    kind: 'hazard',
    name: doc.name,
    level,
    complex: Boolean(s.details?.isComplex),
    rarity: s.traits?.rarity ?? 'common',
    traits: s.traits?.value ?? [],
    source: {
      book: publication.title || null,
      license: publication.license ?? null,
      remaster: publication.remaster ?? false,
      pack,
      tier: packTier(pack),
      page: null,
    },
    stealth: {
      dc: s.attributes?.stealth?.value ?? null,
      details: s.attributes?.stealth?.details
        ? resolve(s.attributes.stealth.details, ctx)
        : null,
    },
    ac: { value: s.attributes?.ac?.value ?? null },
    saves: Object.fromEntries(['fortitude', 'reflex', 'will'].map((k) => [k, {
      mod: s.saves?.[k]?.value ?? null,
      note: s.saves?.[k]?.saveDetail || null,
    }])),
    hp: {
      max: s.attributes?.hp?.max ?? null,
      // Hazards, unlike creatures, carry hardness as a real field.
      hardness: s.attributes?.hardness ?? null,
      brokenThreshold: s.attributes?.hp?.brokenThreshold ?? null,
      details: s.attributes?.hp?.details || null,
      hasHealth: s.attributes?.hasHealth ?? (s.attributes?.hp?.max ?? 0) > 0,
    },
    immunities: (s.attributes?.immunities ?? []).map((e) => normalizeImmunity(e, localize)),
    weaknesses: (s.attributes?.weaknesses ?? []).map((e) => normalizeWeakness(e, localize)),
    resistances: (s.attributes?.resistances ?? []).map((e) => normalizeResistance(e, localize)),
    strikes: items.filter((i) => i.type === 'melee').map((item) => ({
      name: item.name,
      kind: item.system.range ? 'ranged' : 'melee',
      mod: item.system.bonus?.value ?? 0,
      damage: Object.values(item.system.damageRolls ?? {}).map((roll) => ({
        formula: roll.damage, type: roll.damageType, category: roll.category ?? null,
      })),
      traits: item.system.traits?.value ?? [],
    })),
    abilities,
    disable: s.details?.disable ? resolve(s.details.disable, ctx) : null,
    reset: s.details?.reset ? resolve(s.details.reset, ctx) : null,
    routine: s.details?.routine ? resolve(s.details.routine, ctx) : null,
    description: {
      notes: s.details?.description ? resolve(s.details.description, ctx) : null,
    },
    items: items
      .filter((i) => i.type === 'consumable' || i.type === 'equipment')
      .map((i) => ({ name: i.name, ref: slugify(i.name), quantity: i.system.quantity ?? 1 })),
    label: titleCase(doc.name),
  };
}
