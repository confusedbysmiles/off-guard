/**
 * Check expressions.
 *
 * Shared by the data build, the rules engine and the browser, for the same
 * reason as damage expressions: elite/weak has to rewrite a DC *inside* ability
 * text, and the rewrite has to render identically everywhere.
 *
 * Foundry writes checks as `@Check[reflex|dc:41|basic]`.
 */

const SAVE_STATISTICS = new Set(['fortitude', 'reflex', 'will']);

const titleCase = (s) =>
  String(s).replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Parse one `@Check[...]` payload into `{statistic, dc, basic, name, traits}`. */
export function parseCheckPayload(payload) {
  const segments = String(payload).split('|');
  const statistic = (segments.shift() ?? '').trim().toLowerCase();
  const check = { statistic, dc: null, basic: false, name: null, traits: [] };
  for (const seg of segments) {
    const idx = seg.indexOf(':');
    if (idx === -1) {
      if (seg.trim() === 'basic') check.basic = true;
      continue;
    }
    const key = seg.slice(0, idx).trim();
    const value = seg.slice(idx + 1).trim();
    if (key === 'dc') check.dc = Number.isNaN(Number(value)) ? value : Number(value);
    else if (key === 'name') check.name = value;
    else if (key === 'traits') check.traits = value.split(',').map((t) => t.trim());
  }
  return check;
}

/**
 * Render a parsed check as the text a GM reads: `DC 41 basic Reflex save`.
 *
 * Fuller than Foundry's own renderer, which stops at "DC 41 basic Reflex" and
 * relies on the surrounding prose supplying "save". The markup resolver drops
 * that duplicate rather than leaving "Reflex save save".
 */
export function renderCheck(check) {
  const dc = check.dc === null ? '' : `DC ${check.dc} `;
  if (check.statistic === 'flat') return `${dc}flat check`;
  const label = SAVE_STATISTICS.has(check.statistic)
    ? `${titleCase(check.statistic)} save`
    : titleCase(check.statistic);
  const basic = check.basic ? 'basic ' : '';
  const name = check.name ? ` (${check.name})` : '';
  return `${dc}${basic}${label}${name}`;
}

/** Shift a check's DC, leaving a non-numeric (formula) DC alone. */
export function adjustCheckDc(check, delta) {
  if (!delta || typeof check.dc !== 'number') return check;
  return { ...check, dc: check.dc + delta };
}
