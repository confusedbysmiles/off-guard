/**
 * Attribute modifiers, from the boosts a character actually chose.
 *
 * The remaster builds modifiers directly rather than scores, and the rule that
 * catches people out is the partial boost: once a modifier reaches +4, each
 * further boost is worth only half a point, so two of them are needed to move
 * it. A builder that adds a flat +1 hands every level 10 character a key
 * attribute one point too high, which is +1 to their class DC, their attack
 * rolls and their spell DC at once -- wrong in a way that looks merely lucky.
 *
 * Verified against the pinned upstream rather than from memory:
 * `src/module/actor/character/document.ts`, `prepareBuildData`, at commit
 * 8c8a688a3225ac8147c1cb24e4c570bc22db954b --
 *
 *     ability.mod += ability.mod >= 4 ? 0.5 : 1;
 *
 * with flaws applied inside the ancestry section, an apex item raising its
 * attribute to at least +4, a clamp to [-5, +10], and truncation to an integer
 * only at the very end. The half-points are real and they accumulate: a
 * character who boosts the same attribute at 10 and 15 from +4 gains a full
 * point across the two.
 */

export const ATTRIBUTES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const ATTRIBUTE_NAMES = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

/** The order boosts are applied in. Ancestry first, then the level-ups. */
export const BOOST_SECTIONS = ['ancestry', 'background', 'class', 1, 5, 10, 15, 20];

/** The levels at which a character chooses four free boosts. */
export const BOOST_LEVELS = [1, 5, 10, 15, 20];

/** How many boosts a section grants, for validating a chosen set. */
export const BOOSTS_PER_LEVEL = 4;

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

/**
 * Apply one boost to a running modifier.
 * Exported because the interface shows the player what their next boost is
 * worth, and it must be the same arithmetic that produced the current value.
 */
export const boosted = (mod) => mod + (mod >= 4 ? 0.5 : 1);

/**
 * @param {object} boosts   `{ ancestry: ['str'], background: [...], class: 'str',
 *                             1: [...], 5: [...], 10: [...], 15: [...], 20: [...] }`
 * @param {object} options
 * @param {string[]} options.flaws   ancestry flaws, applied within the ancestry section
 * @param {string|null} options.apex an apex item's attribute, level 17 and up
 * @param {number} options.level     boosts above this level are ignored, so a
 *                                   planned level 15 boost does not reach a
 *                                   level 9 character's sheet
 * @returns {{mods: object, exact: object}}  `mods` are truncated integers, the
 *   ones every other statistic uses; `exact` keeps the halves so the interface
 *   can say why a boost appeared to do nothing.
 */
export function attributeModifiers(boosts = {}, { flaws = [], apex = null, level = 20 } = {}) {
  const exact = Object.fromEntries(ATTRIBUTES.map((a) => [a, 0]));

  for (const section of BOOST_SECTIONS) {
    // A boost chosen for a level the character has not reached is a plan, not a
    // statistic. Dropping it here is what lets a player fill in level 15 today
    // without their sheet changing until they get there.
    if (typeof section === 'number' && section > level) continue;

    const chosen = boosts[section];
    const list = typeof chosen === 'string' ? [chosen] : (chosen ?? []);
    for (const attribute of list) {
      if (!ATTRIBUTES.includes(attribute)) continue;
      exact[attribute] = boosted(exact[attribute]);
    }

    // Flaws are an ancestry's alone, and land after that ancestry's boosts.
    if (section === 'ancestry') {
      for (const attribute of flaws) {
        if (!ATTRIBUTES.includes(attribute)) continue;
        exact[attribute] -= 1;
      }
    }
  }

  if (apex && ATTRIBUTES.includes(apex) && level >= 17) {
    exact[apex] = Math.max(exact[apex] + 1, 4);
  }

  for (const attribute of ATTRIBUTES) {
    exact[attribute] = clamp(exact[attribute], -5, 10);
  }

  return {
    mods: Object.fromEntries(ATTRIBUTES.map((a) => [a, Math.trunc(exact[a])])),
    exact,
  };
}

/**
 * What is wrong with a set of boost choices.
 *
 * Reported rather than corrected: a half-finished character is the normal state
 * of one being built, and a builder that silently fills in the blanks is a
 * builder the player cannot trust. Each problem names the section so the
 * interface can put the message beside the choice that caused it.
 */
export function boostProblems(boosts = {}, { ancestryBoosts = [], backgroundBoosts = [], level = 1 } = {}) {
  const problems = [];

  const duplicated = (list, where) => {
    const seen = new Set();
    for (const attribute of list ?? []) {
      if (seen.has(attribute)) {
        problems.push({ section: where, kind: 'duplicate', attribute,
          message: `Two boosts at ${where} both raise ${ATTRIBUTE_NAMES[attribute] ?? attribute}. Each must be a different attribute.` });
      }
      seen.add(attribute);
    }
  };

  const expect = (list, want, where) => {
    const got = (list ?? []).length;
    if (got < want) {
      problems.push({ section: where, kind: 'incomplete', got, want,
        message: `${want - got} more ${want - got === 1 ? 'boost' : 'boosts'} to choose at ${where}.` });
    } else if (got > want) {
      problems.push({ section: where, kind: 'excess', got, want,
        message: `${got - want} too many boosts at ${where}.` });
    }
  };

  expect(boosts.ancestry, ancestryBoosts.length, 'ancestry');
  expect(boosts.background, backgroundBoosts.length, 'background');
  duplicated(boosts.ancestry, 'ancestry');
  duplicated(boosts.background, 'background');

  if (!boosts.class) {
    problems.push({ section: 'class', kind: 'incomplete', got: 0, want: 1,
      message: 'Choose a key attribute for your class.' });
  }

  for (const boostLevel of BOOST_LEVELS) {
    if (boostLevel > level) continue;
    expect(boosts[boostLevel], BOOSTS_PER_LEVEL, `level ${boostLevel}`);
    duplicated(boosts[boostLevel], `level ${boostLevel}`);
  }

  return problems;
}
