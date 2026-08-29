/**
 * A stat block, as a dialog.
 *
 * Renders the record the server sends, already adjusted. Nothing here does
 * arithmetic: elite, weak and level scaling were applied by the rules engine
 * before this saw the creature, including inside the ability text.
 */
import { el, formatMod, titleCase } from '../../lib/dom.js';

const line = (label, ...children) => el('p', { class: 'statblock__line' },
  el('strong', {}, label), ' ', ...children);

const list = (entries) => entries
  .map((e) => e.label ?? e.type ?? String(e))
  .join(', ');

export function statBlock(creature) {
  const badges = [
    creature.rarity !== 'common' ? creature.rarity : null,
    creature.adjustment?.label ?? null,
    creature.scaling && creature.scaling.steps
      ? `Scaled ${creature.scaling.steps > 0 ? '+' : ''}${creature.scaling.steps}`
      : null,
  ].filter(Boolean);

  return el('article', { class: 'statblock' },
    el('header', { class: 'statblock__head' },
      el('h2', {}, creature.name),
      el('span', { class: 'statblock__level' }, `Creature ${creature.level}`)),

    badges.length
      ? el('div', { class: 'chips' }, ...badges.map((b) => el('span', { class: 'pill pill--warn' }, titleCase(b))))
      : null,

    creature.scaling?.approximate
      ? el('p', { class: 'faint' },
        'Level scaling is an approximation. Every number is placed on the '
        + `creature-building tables (${creature.scaling.source}) and read back `
        + 'at the new level, but moving a creature between levels is not a '
        + 'rules-as-written adjustment the way elite and weak are.')
      : null,

    el('div', { class: 'chips' },
      el('span', { class: 'pill' }, creature.size.label),
      ...(creature.traits ?? []).map((t) => el('span', { class: 'pill' }, t))),

    line('Perception', formatMod(creature.perception.mod),
      creature.perception.sensesLabel ? `; ${creature.perception.sensesLabel}` : ''),

    creature.languages?.value?.length
      ? line('Languages', creature.languages.value.map(titleCase).join(', '))
      : null,

    creature.skills?.length
      ? line('Skills', creature.skills.map((s) => `${s.label} ${formatMod(s.mod)}`).join(', '))
      : null,

    line('Attributes', ['str', 'dex', 'con', 'int', 'wis', 'cha']
      .map((k) => `${titleCase(k)} ${formatMod(creature.abilityMods[k])}`).join(', ')),

    creature.items?.length
      ? line('Items', creature.items.map((i) => i.name + (i.quantity > 1 ? ` (${i.quantity})` : '')).join(', '))
      : null,

    el('hr'),

    line('AC', String(creature.ac.value),
      `; Fort ${formatMod(creature.saves.fortitude.mod)}`,
      `, Ref ${formatMod(creature.saves.reflex.mod)}`,
      `, Will ${formatMod(creature.saves.will.mod)}`,
      creature.saves.allNote ? `; ${creature.saves.allNote}` : ''),

    line('HP', String(creature.hp.max),
      creature.hp.regeneration ? `; Regeneration ${creature.hp.regeneration.amount}` : '',
      creature.hp.hardness ? `; Hardness ${creature.hp.hardness}` : ''),

    creature.immunities?.length ? line('Immunities', list(creature.immunities)) : null,
    creature.weaknesses?.length ? line('Weaknesses', list(creature.weaknesses)) : null,
    creature.resistances?.length ? line('Resistances', list(creature.resistances)) : null,

    ...abilityGroup(creature.abilities.reaction),
    ...abilityGroup(creature.abilities.passive),

    el('hr'),

    line('Speed', creature.speeds.label ?? `${creature.speeds.land} feet`),

    ...(creature.strikes ?? []).map((strike) => el('p', { class: 'statblock__line' },
      el('strong', {}, titleCase(strike.kind)), ' ',
      el('em', {}, strike.name), ' ', formatMod(strike.mod),
      strike.traits?.length ? ` (${strike.traits.join(', ')})` : '',
      ', Damage ',
      strike.damage.map((d) => `${d.formula} ${d.category === 'persistent' ? 'persistent ' : ''}${d.type}`)
        .join(' plus '))),

    ...(creature.spellcasting ?? []).map(spellcastingBlock),
    ...abilityGroup(creature.abilities.action),
    ...abilityGroup(creature.abilities.free),

    el('footer', { class: 'statblock__source faint' },
      [creature.source.book, creature.source.page ? `p. ${creature.source.page}` : null]
        .filter(Boolean).join(', '),
      creature.source.license ? ` · ${creature.source.license}` : ''));
}

function abilityGroup(abilities) {
  return (abilities ?? []).map((ability) => {
    const body = el('div', { class: 'statblock__ability' });
    body.append(el('strong', {}, ability.name));
    if (ability.cost?.type === 'action') {
      body.append(el('span', { class: 'pill' }, `${ability.cost.count} action${ability.cost.count === 1 ? '' : 's'}`));
    } else if (ability.cost?.type && ability.cost.type !== 'passive') {
      body.append(el('span', { class: 'pill' }, titleCase(ability.cost.type)));
    }
    if (ability.traits?.length) {
      body.append(el('span', { class: 'faint' }, ` (${ability.traits.join(', ')})`));
    }
    // The resolver already turned Foundry's markup into safe HTML with the
    // adjusted numbers written into the sentence; rendering it as text would
    // throw away the internal links.
    body.append(el('div', { class: 'statblock__text', html: ability.text?.html ?? '' }));
    return body;
  });
}

function spellcastingBlock(entry) {
  return el('div', { class: 'statblock__ability' },
    el('strong', {}, entry.name || `${titleCase(entry.tradition ?? '')} ${entry.kind ?? ''} Spells`),
    el('span', { class: 'faint' },
      ` DC ${entry.dc ?? '—'}${entry.attackMod ? `, attack ${formatMod(entry.attackMod)}` : ''}`),
    ...entry.ranks.map((rank) => el('p', { class: 'statblock__line' },
      el('strong', {}, rank.rank === 0 ? 'Cantrips' : `${rank.rank}${ordinal(rank.rank)}`),
      rank.slotsMax ? ` (${rank.slotsMax} slots)` : '', ' ',
      rank.spells.map((s) => s.name).join(', '))));
}

const ordinal = (n) => (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] ?? ['th', 'st', 'nd', 'rd'][n % 100] ?? 'th');
