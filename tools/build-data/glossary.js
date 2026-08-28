/**
 * The NPC ability glossary.
 *
 * ~7,300 `@Localize[PF2E.NPC.Abilities.Glossary.*]` references across the corpus
 * point at prose that is *not* in the creature files — Grab, Regeneration,
 * Constrict, Frightful Presence, Void Healing and 50 others live in the system's
 * lang file. Without inlining these, a large share of stat blocks would render
 * with empty abilities.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Flatten the nested lang object into `A.B.C` -> string. */
function flatten(node, prefix, out) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else if (value && typeof value === 'object') flatten(value, path, out);
  }
  return out;
}

export function loadGlossary(upstream) {
  const dir = resolve(upstream, 'static/lang');
  const glossary = new Map();
  // Not just en.json: rule-element strings such as the IWR exception labels
  // ("magical bludgeoning") live in re-en.json.
  for (const file of readdirSync(dir).filter((f) => f.endsWith('-en.json') || f === 'en.json')) {
    const lang = JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
    for (const [key, value] of flatten(lang, '', new Map())) {
      if (key.startsWith('PF2E.') && !glossary.has(key)) glossary.set(key, value);
    }
  }
  return glossary;
}
