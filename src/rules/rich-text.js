/**
 * Rewriting numbers inside resolved ability text.
 *
 * Ability prose is stored as `{ html, text, damage[], checks[], links[] }`,
 * where the html carries markers that index into the sibling arrays:
 *
 *     <span class="og-dmg" data-og-dmg="0">18d6 fire</span>
 *     <span class="og-chk" data-og-chk="0">DC 41 basic Reflex save</span>
 *
 * An elite adjustment has to make that read "18d6+4 fire" and "DC 43", inside
 * the sentence. Adjusting the parsed arrays and re-rendering the marker bodies
 * does that without re-parsing English or doing surgery on rendered prose.
 */
import { adjustDamageParts, renderDamageParts } from '../shared/damage-expression.js';
import { adjustCheckDc, renderCheck } from '../shared/check-expression.js';

const MARKER = /(<span class="og-(dmg|chk)" data-og-(?:dmg|chk)="(\d+)">)([\s\S]*?)(<\/span>)/g;

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Strip tags the way the data build does, so `text` stays in step with `html`. */
function htmlToText(html) {
  return String(html)
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Apply flat adjustments to a RichText value and re-render its markers.
 *
 * `damageDelta` is applied by `adjustDamage`, which receives the whole parsed
 * expression -- callers differ on which part of a multi-part expression should
 * take the adjustment, so the decision does not live here.
 */
export function adjustRichText(rich, { adjustDamage = null, dcDelta = 0 } = {}) {
  if (!rich || typeof rich.html !== 'string') return rich;

  const damage = adjustDamage ? (rich.damage ?? []).map(adjustDamage) : (rich.damage ?? []);
  const checks = dcDelta
    ? (rich.checks ?? []).map((c) => adjustCheckDc(c, dcDelta))
    : (rich.checks ?? []);

  const html = rich.html.replace(MARKER, (whole, open, kind, index, body, close) => {
    const i = Number(index);
    if (kind === 'dmg') {
      const entry = damage[i];
      if (!entry) return whole;
      return `${open}${escapeHtml(renderDamageParts(entry.parts))}${close}`;
    }
    const check = checks[i];
    if (!check) return whole;
    // A check with no DC was rendered from its label, not from the payload;
    // re-rendering it would replace the author's wording with a generic one.
    if (check.dc === null) return whole;
    return `${open}${escapeHtml(renderCheck(check))}${close}`;
  });

  return { ...rich, html, text: htmlToText(html), damage, checks };
}

/**
 * The usual damage rule: one flat adjustment per expression, applied to the
 * first non-persistent part.
 *
 * Elite and weak say to change "the damage" of an attack or damaging ability by
 * a fixed amount (Monster Core, Elite and Weak Adjustments). Applying it to
 * every part of `2d6 slashing plus 1d6 fire` would double the adjustment, and
 * applying it to persistent damage would change an effect the adjustment does
 * not mention. First non-persistent part is the reading this implements.
 */
export function flatDamageAdjuster(delta) {
  if (!delta) return null;
  return (expression) => {
    const parts = expression.parts ?? [];
    const target = parts.findIndex((p) => !p.persistent);
    if (target === -1) return expression;
    const adjusted = parts.map((p, i) => (
      i === target ? adjustDamageParts([p], delta)[0] : p
    ));
    return { ...expression, parts: adjusted };
  };
}
