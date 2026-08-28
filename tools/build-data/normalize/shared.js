/** Small helpers shared by the creature and hazard normalizers. */
import { SIZE_NAMES } from '../catalog.js';

/**
 * Slug -> printed words. PF2e drops most hyphens ("ghost-touch" prints as
 * "ghost touch") but keeps the negating prefixes ("non-magical", "non-lethal").
 */
export const words = (slug) =>
  String(slug ?? '')
    .replace(/^(non|un|semi)-/, '$1\u0000')
    .replace(/[-_]+/g, ' ')
    .replace(/\u0000/g, '-');
export const titleCase = (s) => words(s).replace(/\b[a-z]/g, (c) => c.toUpperCase());
export const sizeName = (code) => SIZE_NAMES[code] ?? titleCase(code ?? '');

/** Join with commas and a trailing conjunction: `a, b, or c`. */
export function joinList(items, conjunction = 'and') {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list.join('');
  if (list.length === 2) return `${list[0]} ${conjunction} ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, ${conjunction} ${list.at(-1)}`;
}

/**
 * Immunities, weaknesses and resistances.
 *
 * Foundry stores `exceptions` and `doubleVs` as structured arrays; PF2e prints
 * them as prose. We keep both: the structure for filtering, the label for the
 * stat block. Note that some creatures express IWR *only* through Foundry rule
 * elements (the lich's Void Healing resistance), which we cannot evaluate — see
 * `mineRuleElementIwr`.
 */
/**
 * An IWR exception is usually a plain type slug, but rule-element IWR uses
 * `{ definition, label }` where `label` is a localization key ("magical
 * bludgeoning"). Resolve it when we can and never render `[object Object]`.
 */
export function exceptionLabel(exception, localize) {
  if (typeof exception === 'string') return words(exception);
  if (exception && typeof exception === 'object') {
    const localized = exception.label ? localize?.(exception.label) : null;
    if (localized) return localized;
    if (exception.label) return words(String(exception.label).split('.').pop());
    if (Array.isArray(exception.definition)) {
      return exception.definition.map((d) => words(String(d).split(':').pop())).join(' ');
    }
  }
  return String(exception);
}

export function normalizeImmunity(entry, localize) {
  const type = entry.type;
  const exceptions = entry.exceptions ?? [];
  const labels = exceptions.map((e) => exceptionLabel(e, localize));
  const label = labels.length
    ? `${words(type)} (except ${joinList(labels, 'or')})`
    : words(type);
  return { type, exceptions: labels, label };
}

export function normalizeWeakness(entry, localize) {
  const labels = (entry.exceptions ?? []).map((e) => exceptionLabel(e, localize));
  const base = `${words(entry.type)} ${entry.value}`;
  const label = labels.length
    ? `${base} (except ${joinList(labels, 'or')})`
    : base;
  return { type: entry.type, value: entry.value, exceptions: labels, label };
}

export function normalizeResistance(entry, localize) {
  const exceptions = (entry.exceptions ?? []).map((e) => exceptionLabel(e, localize));
  const doubleVs = (entry.doubleVs ?? []).map((e) => exceptionLabel(e, localize));
  const notes = [];
  if (exceptions.length) notes.push(`except ${joinList(exceptions, 'or')}`);
  if (doubleVs.length) notes.push(`double vs. ${joinList(doubleVs, 'or')}`);
  const base = `${words(entry.type)} ${entry.value}`;
  const label = notes.length ? `${base} (${notes.join('; ')})` : base;
  return { type: entry.type, value: entry.value, exceptions, doubleVs, label };
}

/** `{type:'scent', acuity:'imprecise', range:30}` -> `imprecise scent 30 feet`. */
export function normalizeSense(sense) {
  const parts = [];
  if (sense.acuity) parts.push(sense.acuity);
  parts.push(words(sense.type));
  if (sense.range) parts.push(`${sense.range} feet`);
  return {
    type: sense.type,
    acuity: sense.acuity ?? null,
    range: sense.range ?? null,
    label: parts.join(' '),
  };
}

/**
 * Regeneration, fast healing and hardness are free text in `attributes.hp.details`
 * ("regeneration 20 (deactivated by electricity or fire)"). NPCs have no hardness
 * field at all. Parse what we can and always keep the original string, because a
 * failed parse must not lose the GM's information.
 */
export function parseHpDetails(details) {
  const text = String(details ?? '').trim();
  const out = { text, regeneration: null, fastHealing: null, hardness: null };
  if (!text) return out;

  const regen = /regeneration\s+(\d+)\s*(?:\(([^)]*)\))?/i.exec(text);
  if (regen) {
    out.regeneration = {
      amount: Number(regen[1]),
      deactivatedBy: regen[2] ? regen[2].replace(/^deactivated by\s*/i, '').trim() : null,
    };
  }
  const fast = /fast healing\s+(\d+)/i.exec(text);
  if (fast) out.fastHealing = Number(fast[1]);

  const hardness = /hardness\s+(\d+)/i.exec(text);
  if (hardness) out.hardness = Number(hardness[1]);

  return out;
}

/**
 * Recover the IWR that only exists as Foundry rule elements. We do not evaluate
 * rule elements in general — they are runtime automation — but `Resistance`,
 * `Weakness`, `Immunity` and `FastHealing` carry printed stat block facts that
 * are otherwise absent (e.g. the lich's Void Healing).
 */
export function mineRuleElementIwr(items) {
  const found = { resistances: [], weaknesses: [], immunities: [], fastHealing: null };
  for (const item of items) {
    for (const rule of item.system?.rules ?? []) {
      const value = typeof rule.value === 'number' ? rule.value : null;
      if (rule.key === 'Resistance' && rule.type && value !== null) {
        found.resistances.push({ type: String(rule.type), value, exceptions: rule.exceptions ?? [], source: item.name });
      } else if (rule.key === 'Weakness' && rule.type && value !== null) {
        found.weaknesses.push({ type: String(rule.type), value, exceptions: rule.exceptions ?? [], source: item.name });
      } else if (rule.key === 'Immunity' && rule.type) {
        found.immunities.push({ type: String(rule.type), exceptions: rule.exceptions ?? [], source: item.name });
      } else if (rule.key === 'FastHealing' && value !== null) {
        // `type` distinguishes regeneration from plain fast healing, and
        // `deactivatedBy` is structured here where the HP details string is not.
        found.fastHealing = {
          amount: value,
          type: rule.type ?? 'fast-healing',
          deactivatedBy: rule.deactivatedBy ?? null,
          source: item.name,
        };
      }
    }
  }
  return found;
}
