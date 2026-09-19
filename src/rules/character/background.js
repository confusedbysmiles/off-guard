/**
 * A background the catalogue does not have.
 *
 * The same idea as a described weapon -- see `customWeapon` and its neighbours
 * -- and for the same reason: a GM writes one for their setting, or a book
 * arrives before the compendium build catches up, and a character is left
 * unable to say where they came from.
 *
 * A background in Pathfinder is four things, and only the first three reach
 * any number: two attribute boosts, one of which is chosen from a short list
 * and one of which is free; training in one skill; training in one Lore. The
 * fourth is a skill feat, and this engine does not apply granted feats for
 * catalogue backgrounds either -- see the note in `derive.js` about what a
 * feat mechanically does -- so it is recorded, shown, and left to the player
 * to take. Pretending otherwise would be a number nobody could check.
 *
 * Sanitised on the way in, like everything else a browser sends: the build
 * document is written by the player's own browser, and an attribute of
 * `"strength"` or a skill of `"lockpicking"` would otherwise reach the
 * derivation and quietly grant nothing while looking as though it had.
 */
import { ATTRIBUTES } from './attributes.js';
import { SKILLS } from './derive.js';

/** A named Lore is free text -- "Caravan Lore" is not in any list. */
const loreName = (value) => String(value ?? '').trim().slice(0, 60);

export function customBackground(custom) {
  if (!custom) return null;

  /**
   * The restricted boost.
   *
   * Printed backgrounds offer a choice of two -- "Strength or Constitution".
   * An empty list means the player did not narrow it, and the honest reading
   * of that is "any", not "none": a background that granted no boost at all
   * would be a background that is wrong rather than one that is generous.
   */
  const limited = [...new Set((custom.boosts ?? []).filter((a) => ATTRIBUTES.includes(a)))];

  const skill = SKILLS.includes(custom.skill) ? custom.skill : null;
  const lore = loreName(custom.lore);

  return {
    id: null,
    kind: 'background',
    name: String(custom.name ?? '').trim().slice(0, 60) || 'Custom background',
    level: 0,
    rarity: 'common',
    traits: [],
    source: { book: 'Your own', pack: null, tier: null, remaster: true, license: null },
    // Both are `free` in the data's sense -- the player picks each one. The
    // first is narrowed to a list, the second is any of the six.
    boosts: [
      { free: true, options: limited.length ? limited : [...ATTRIBUTES] },
      { free: true, options: [...ATTRIBUTES] },
    ],
    trainedSkills: skill ? [skill] : [],
    trainedLore: lore ? [lore] : [],
    // Carried for the player to read, never applied. The same is true of a
    // catalogue background's own granted feat.
    grantedFeat: String(custom.feat ?? '').trim().slice(0, 60) || null,
    custom: true,
  };
}

/**
 * The background a build points at, from wherever it comes.
 *
 * A string is a catalogue id. An object carries its own description. Anything
 * else -- including an id the catalogue no longer has -- is nothing, which is
 * how a background removed by an upstream bump shows as a gap rather than
 * silently becoming a different one.
 */
export function resolveBackground(choice, lookUp) {
  if (typeof choice === 'string' && choice) return lookUp(choice) ?? null;
  if (choice && typeof choice === 'object') return customBackground(choice.custom);
  return null;
}

/** Whether a build's background is described rather than chosen. */
export const isCustomBackground = (choice) =>
  Boolean(choice && typeof choice === 'object' && choice.custom);
