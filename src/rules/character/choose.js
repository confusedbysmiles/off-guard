/**
 * Filling one slot.
 *
 * Lifted out of the builder page, which is where it used to live, because it
 * is about to have a second caller: a request that says "put Dwarf in the
 * ancestry slot" without a browser anywhere. Two copies of what filling a slot
 * means is how the two drift, and the drift that matters here would be a
 * choice made through one door that the other would have refused.
 *
 * Pure. Takes a build and gives back a new one, and knows nothing about the
 * catalogue -- whether a choice is *legal* is a separate question with a
 * separate answer, because it needs the options and this does not.
 */
import { ATTRIBUTES } from './attributes.js';
import { SKILLS } from './derive.js';

const IDENTITY = ['ancestry', 'heritage', 'background', 'class'];

const asList = (value) => (Array.isArray(value) ? value : [value]).filter(
  (v) => v !== null && v !== undefined && v !== '',
);

/**
 * @param {object} build  the current build document
 * @param {object} slot   a slot from `slotsFor`
 * @param {*}      value  an option id, an attribute, a list of either, or null
 *                        to clear the slot
 * @returns {object} a new build
 */
export function fillSlot(build, slot, value) {
  const next = structuredClone(build ?? {});
  const id = Array.isArray(value) ? null : value;

  /**
   * Equipment keeps its runes and its name when the base item changes: a
   * player swapping a longsword for a greatsword has not thrown away the
   * striking rune they paid for.
   */
  if (slot.kind === 'armor' || slot.kind === 'shield') {
    next.equipment ??= {};
    next.equipment[slot.kind] = id ? { ...(next.equipment[slot.kind] ?? {}), id } : null;
    return next;
  }

  if (slot.kind === 'weapon' || slot.kind === 'gear') {
    next.equipment ??= {};
    const key = slot.kind === 'weapon' ? 'weapons' : 'gear';
    const list = [...(next.equipment[key] ?? [])];
    const current = list[slot.index] ?? {};
    list[slot.index] = slot.kind === 'gear'
      ? { ...current, id, quantity: current.quantity ?? 1 }
      : { ...current, id };
    next.equipment[key] = list;
    return next;
  }

  if (IDENTITY.includes(slot.kind)) {
    next[slot.kind] = id ?? null;
    /**
     * A new ancestry invalidates a heritage that belonged to the old one, and
     * leaving it would silently keep a dwarf heritage on an elf. The boosts go
     * for the same reason: they were chosen from a list this ancestry may not
     * offer.
     */
    if (slot.kind === 'ancestry') {
      next.heritage = null;
      next.attributes = { ...(next.attributes ?? {}), ancestry: [] };
    }
    if (slot.kind === 'background') {
      next.attributes = { ...(next.attributes ?? {}), background: [] };
    }
    return next;
  }

  if (slot.kind === 'keyAttribute') {
    next.attributes = { ...(next.attributes ?? {}), class: id ?? null };
    return next;
  }

  if (slot.kind === 'attributeBoosts') {
    next.attributes = {
      ...(next.attributes ?? {}),
      [slot.section]: asList(value).filter((a) => ATTRIBUTES.includes(a)),
    };
    return next;
  }

  if (slot.kind === 'trainedSkills') {
    next.skills = {
      ...(next.skills ?? {}),
      trained: asList(value).filter((s) => SKILLS.includes(s)),
    };
    return next;
  }

  if (slot.kind === 'skillIncrease') {
    const increases = { ...(next.skills?.increases ?? {}) };
    if (id && SKILLS.includes(id)) increases[slot.level] = id;
    else delete increases[slot.level];
    next.skills = { ...(next.skills ?? {}), increases };
    return next;
  }

  if (slot.kind === 'lores') {
    next.skills = {
      ...(next.skills ?? {}),
      lores: asList(value).map((lore) => (typeof lore === 'string'
        ? { name: lore, rank: 'trained' }
        : { name: String(lore?.name ?? ''), rank: lore?.rank ?? 'trained' }))
        .filter((lore) => lore.name.trim()),
    };
    return next;
  }

  // Everything left is a feat, keyed by the slot's own id -- which is what
  // makes planning work: a level 12 class feat and a level 2 one are two keys.
  next.feats ??= {};
  if (id) next.feats[slot.id] = id;
  else delete next.feats[slot.id];
  return next;
}

/**
 * Whether a value is one this slot could hold.
 *
 * The catalogue question -- is this id a thing the slot's filter would have
 * offered -- is answered by `offers`, passed in, because that rule lives in
 * the options module and there must be exactly one of it. What is checked here
 * is everything else: the shape, the vocabulary, and the count.
 *
 * Nothing in the browser calls this. The picker only ever offers legal
 * choices, so the page has nothing to check. A caller that is not a picker --
 * a model, say, choosing from a list it was given a minute ago -- has plenty.
 *
 * @returns {string|null} what is wrong, or null
 */
export function checkChoice(slot, value, { offers = () => true } = {}) {
  if (!slot) return 'There is no such slot on this character.';
  if (slot.blockedBy) return `Choose ${slot.blockedBy} first.`;

  const list = asList(value);

  if (slot.kind === 'attributeBoosts') {
    const bad = list.find((a) => !ATTRIBUTES.includes(a));
    if (bad) return `${bad} is not an attribute. They are: ${ATTRIBUTES.join(', ')}.`;
    if (new Set(list).size !== list.length) return 'One boost each; the same attribute cannot take two.';
    if (list.length > (slot.count ?? 1)) {
      return `${slot.label} takes ${slot.count}, and ${list.length} were given.`;
    }
    const offered = (slot.options ?? []).flatMap((entry) => entry ?? []);
    const narrowed = (slot.options ?? []).some((entry) => Array.isArray(entry) && entry.length);
    const outside = narrowed && list.find((a) => offered.length && !offered.includes(a));
    if (outside) return `${outside} is not among what this slot offers: ${[...new Set(offered)].join(', ')}.`;
    return null;
  }

  if (slot.kind === 'keyAttribute') {
    if (!list.length) return null;
    const offered = (slot.options ?? [])[0] ?? [];
    if (offered.length && !offered.includes(list[0])) {
      return `This class's key attribute is one of: ${offered.join(', ')}.`;
    }
    return null;
  }

  if (slot.kind === 'trainedSkills' || slot.kind === 'skillIncrease') {
    const bad = list.find((s) => !SKILLS.includes(s));
    if (bad) return `${bad} is not one of the sixteen skills.`;
    if (slot.kind === 'skillIncrease' && list.length > 1) return 'A skill increase raises one skill.';
    if (slot.kind === 'trainedSkills' && list.length > (slot.count ?? 0)) {
      return `This character trains ${slot.count} skills, and ${list.length} were given.`;
    }
    return null;
  }

  if (slot.kind === 'lores') return null;

  // Everything else is answered by an id out of the catalogue.
  if (!list.length) return null;
  if (list.length > 1) return `${slot.label} holds one choice.`;
  const reason = offers(slot, list[0]);
  return reason === true ? null : reason;
}
