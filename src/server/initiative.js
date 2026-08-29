/**
 * Rolling initiative.
 *
 * Creature rolls happen on the server because the roll needs the stat block: a
 * modifier sent up from the browser would let a mistake in the interface change
 * the numbers, and the stat block is here already.
 *
 * A player character's initiative is *not* rolled. The rules have the player
 * roll it, so the tracker takes what the sheet says or leaves the field empty
 * for the GM to type -- inventing a number for someone else's character is the
 * one thing a tracker must not do.
 */
import { addCombatant } from './store/combat.js';
import { getEncounter } from './store/encounters.js';
import { adjustCreature, scaleCreature } from '../rules/index.js';

/** A d20 roll. Uses the platform's cryptographic source; this is not a hot path. */
function d20(random = defaultRandom) {
  return 1 + Math.floor(random() * 20);
}

function defaultRandom() {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] / 2 ** 32;
}

/** The modifier a creature rolls initiative with, for the chosen statistic. */
export function initiativeModifier(creature, skill = 'perception') {
  if (skill === 'perception') return creature.perception?.mod ?? 0;
  const match = (creature.skills ?? []).find((s) => s.slug === skill);
  // Falling back to Perception is what a GM does at the table when a creature
  // has no ranks in the skill they asked for, and it is visible in the result.
  return match ? match.mod : (creature.perception?.mod ?? 0);
}

/**
 * The name to letter from.
 *
 * A row saved as "Goblin Warrior A" -- by an older build, or by a GM who typed
 * the letter -- must not become "Goblin Warrior A A" when it expands into three
 * combatants. The trailing letter is dropped only when what remains is the
 * creature's own name, so a row deliberately called "Squad B" keeps it.
 */
export function baseNameFor(displayName, creatureName) {
  const name = displayName || creatureName;
  const match = /^(.*) [A-Z]$/.exec(name);
  return match && match[1] === creatureName ? creatureName : name;
}

export function rollInitiative({
  db, scope, catalogue, campaignId, combatId, party, encounterId,
  skill = 'perception', includeParty = true, random = defaultRandom,
}) {
  const added = [];

  if (includeParty) {
    for (const character of party.characters) {
      added.push(addCombatant(db, scope, combatId, {
        characterId: character.id,
        displayName: character.name,
        // Left null on purpose: the player rolls this, or the GM types it.
        initiative: null,
        hpCurrent: character.hp.current,
        hpMax: character.hp.max,
        hpTemp: character.hp.temp,
        heroPoints: character.heroPoints,
        visible: true,
        hpNumeric: true,
      }, campaignId));
    }
  }

  if (encounterId) {
    const encounter = getEncounter(db, scope, encounterId, campaignId);
    for (const row of encounter.creatures) {
      const base = catalogue.get(row.creatureId);
      if (!base) continue;

      let creature = base;
      if (row.levelScale) creature = scaleCreature(creature, row.levelScale);
      if (row.adjustment) creature = adjustCreature(creature, row.adjustment);

      const count = Math.max(1, row.count ?? 1);
      const label = baseNameFor(row.displayName, creature.name);

      for (let n = 0; n < count; n += 1) {
        const modifier = initiativeModifier(creature, skill);
        const die = d20(random);
        const name = count > 1 ? `${label} ${String.fromCharCode(65 + n)}` : label;

        added.push(addCombatant(db, scope, combatId, {
          creatureId: row.creatureId,
          displayName: name,
          initiative: die + modifier,
          hpCurrent: creature.hp.max,
          hpMax: creature.hp.max,
          // Creatures start hidden from the shared screen: a fight the players
          // walk into should not be listed before they see it.
          visible: false,
          hpNumeric: false,
          // A snapshot, so re-running `npm run build:data` cannot change the
          // stat block of a creature in a fight that is already underway.
          statBlock: creature,
        }, campaignId));
      }
    }
  }

  return added.map((c) => ({ id: c.id, displayName: c.displayName, initiative: c.initiative }));
}
