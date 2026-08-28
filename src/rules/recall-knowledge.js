/**
 * Recall Knowledge against a creature.
 *
 * Which skills apply comes from the creature's traits (GM Core pg. 54, Creature
 * Identification); the DC is the level-based DC adjusted for rarity.
 *
 * On what each degree reveals, the printed guidance is deliberately loose --
 * "a success recalls a well-known attribute, a critical success adds something
 * more subtle" -- and there is no table of exactly which number comes out on
 * which success. Rather than invent one, this returns the creature's facts
 * ordered from most obvious to most obscure and lets the GM reveal them. That
 * ordering is a convenience, not a rule, and is labelled as such.
 */
import { dcByLevel } from './dc.js';
import { RK_SKILL_BY_TRAIT } from './tables/recall-knowledge.js';

/** Skills that can identify this creature, from its traits. */
export function skillsFor(creature) {
  const traits = creature?.traits ?? [];
  const found = new Map();
  for (const trait of traits) {
    for (const skill of RK_SKILL_BY_TRAIT[trait] ?? []) {
      if (!found.has(skill)) found.set(skill, []);
      found.get(skill).push(trait);
    }
  }
  const skills = [...found.entries()].map(([skill, viaTraits]) => ({ skill, viaTraits }));
  // Lore is always available at the GM's discretion, and is the only option for
  // a creature whose traits are all outside the identification table.
  skills.push({ skill: 'lore', viaTraits: [], note: 'Relevant Lore, at the GM’s discretion' });
  return skills;
}

/**
 * Facts a check could reveal, ordered obvious first.
 *
 * The order is this application's convenience, not a printed rule: defences
 * before offence before the exceptions that decide a fight, because that is the
 * order a table asks about them in.
 */
export function factsFor(creature) {
  const facts = [];
  const add = (key, label, value) => {
    if (value === null || value === undefined || value === '') return;
    facts.push({ key, label, value: String(value) });
  };

  add('level', 'Level', creature.level);
  add('ac', 'AC', creature.ac?.value);
  add('hp', 'Hit Points', creature.hp?.max);
  add('perception', 'Perception', formatMod(creature.perception?.mod));
  for (const save of ['fortitude', 'reflex', 'will']) {
    add(`save.${save}`, titleCase(save), formatMod(creature.saves?.[save]?.mod));
  }
  add('speeds', 'Speed', creature.speeds?.label);
  add('senses', 'Senses', creature.perception?.sensesLabel);

  for (const strike of creature.strikes ?? []) {
    add(
      `strike.${strike.name}`,
      `Strike: ${strike.name}`,
      `${formatMod(strike.mod)}, ${strike.damage.map((d) => `${d.formula} ${d.type}`).join(' plus ')}`,
    );
  }

  for (const list of ['immunities', 'weaknesses', 'resistances']) {
    for (const entry of creature[list] ?? []) {
      add(`${list}.${entry.type ?? entry.label}`, titleCase(list.replace(/ies$/, 'y')), entry.label ?? entry.type);
    }
  }

  for (const kind of ['passive', 'action', 'reaction', 'free']) {
    for (const ability of creature.abilities?.[kind] ?? []) {
      add(`ability.${ability.name}`, ability.name, ability.text?.text ?? '');
    }
  }

  return facts;
}

const formatMod = (n) => (typeof n === 'number' ? `${n >= 0 ? '+' : ''}${n}` : null);
const titleCase = (s) => String(s).replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * The whole helper: skills, DC, what each degree means, and the fact list.
 *
 * `revealed` is the set of fact keys the GM has already pushed to the players;
 * it is passed in rather than stored here so this module stays pure.
 */
export function recallKnowledge(creature, { revealed = [], difficulty = null } = {}) {
  const dc = dcByLevel(creature.level, { rarity: creature.rarity, difficulty });
  const revealedSet = new Set(revealed);
  const facts = factsFor(creature).map((f) => ({ ...f, revealed: revealedSet.has(f.key) }));

  return {
    creature: { id: creature.id, name: creature.name, level: creature.level, rarity: creature.rarity },
    skills: skillsFor(creature),
    dc,
    degrees: {
      'critical success': 'The character recalls a well-known attribute and something more subtle.',
      success: 'The character recalls a well-known attribute of the creature.',
      failure: 'The character recalls nothing.',
      'critical failure': 'The character recalls incorrect information. Tell them something wrong.',
    },
    /** Each further success after the first reveals one more fact. Not a printed rule. */
    additionalSuccesses: 'Each additional success reveals one more fact, GM’s choice.',
    facts,
    factOrderIsAdvisory: true,
  };
}
