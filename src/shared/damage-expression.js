/**
 * Damage expressions.
 *
 * Shared by the data build, the rules engine, and the browser, because elite/weak
 * has to rewrite damage *inside* ability text rather than annotate it, and that
 * rewrite has to produce the same string everywhere.
 *
 * Foundry writes damage as `@Damage[(2d6+3)[slashing],1d6[persistent,fire]]`.
 * We keep the parsed parts on the record so a transform can adjust them and the
 * view can re-render, instead of doing string surgery on rendered HTML.
 */

/** Damage type tokens that describe *how* damage applies rather than what it is. */
const CATEGORY_TOKENS = new Set(['persistent', 'precision', 'splash']);

/**
 * Split on commas that are at depth zero with respect to both `(` and `[`.
 * `(2d6+3)[slashing],1d6[fire]` splits; `[persistent,fire]` does not.
 */
function splitTopLevel(str, sep) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === sep && depth === 0) {
      out.push(str.slice(start, i));
      start = i + 1;
    }
  }
  out.push(str.slice(start));
  return out.filter((s) => s.trim() !== '');
}

function stripOuterParens(formula) {
  let f = formula.trim();
  while (f.startsWith('(') && f.endsWith(')')) {
    // Only strip when the parens actually wrap the whole expression.
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < f.length; i += 1) {
      if (f[i] === '(') depth += 1;
      else if (f[i] === ')') {
        depth -= 1;
        if (depth === 0 && i < f.length - 1) { wraps = false; break; }
      }
    }
    if (!wraps) break;
    f = f.slice(1, -1).trim();
  }
  return f;
}

/**
 * Parse one `@Damage[...]` payload.
 * Returns `{ parts, options }`; `parts` is never empty for well-formed input.
 */
export function parseDamageExpression(payload) {
  const [expr, ...rest] = splitTopLevel(String(payload ?? ''), '|');
  const options = {};
  for (const seg of rest) {
    const idx = seg.indexOf(':');
    if (idx === -1) options[seg.trim()] = true;
    else options[seg.slice(0, idx).trim()] = seg.slice(idx + 1).trim();
  }

  const parts = splitTopLevel(expr ?? '', ',').map((raw) => {
    const chunk = raw.trim();
    // The type list is the final bracketed group: `2d6[persistent,fire]`.
    const open = chunk.lastIndexOf('[');
    const close = chunk.lastIndexOf(']');
    let formula = chunk;
    let tokens = [];
    if (open !== -1 && close > open) {
      formula = chunk.slice(0, open);
      tokens = chunk.slice(open + 1, close).split(',').map((t) => t.trim()).filter(Boolean);
    }
    const categories = tokens.filter((t) => CATEGORY_TOKENS.has(t));
    const types = tokens.filter((t) => !CATEGORY_TOKENS.has(t));
    return {
      formula: stripOuterParens(formula),
      types,
      persistent: categories.includes('persistent'),
      category: categories.find((c) => c !== 'persistent') ?? null,
    };
  });

  return { parts, options };
}

/** Render one parsed part as the text a GM reads: `2d6+3 slashing`. */
export function renderDamagePart(part) {
  const words = [];
  if (part.persistent) words.push('persistent');
  if (part.category) words.push(part.category);
  words.push(...part.types);
  const suffix = words.length ? ` ${words.join(' ')}` : '';
  return `${part.formula}${suffix}`;
}

/** Render a whole expression: `2d6+3 slashing plus 1d6 persistent fire`. */
export function renderDamageParts(parts) {
  return parts.map(renderDamagePart).join(' plus ');
}

/**
 * Add a flat amount to a dice formula, folding into the existing constant.
 * `2d6+3` +2 -> `2d6+5`; `2d6` +2 -> `2d6+2`; `1d6+2` -2 -> `1d6`; `5` +2 -> `7`.
 *
 * Returns the formula unchanged when it contains an unresolved runtime reference
 * (`@item.level`), because guessing there would be worse than leaving it alone.
 */
export function adjustFormulaFlat(formula, delta) {
  const f = String(formula ?? '').trim();
  if (!f || delta === 0) return f;
  if (f.includes('@')) return f;

  if (/^-?\d+$/.test(f)) return String(Number(f) + delta);

  const m = f.match(/^(.*?)\s*([+-])\s*(\d+)$/);
  if (m && /d\d/.test(m[1])) {
    const base = m[1].trim();
    const constant = (m[2] === '-' ? -1 : 1) * Number(m[3]) + delta;
    if (constant === 0) return base;
    return `${base}${constant > 0 ? '+' : '-'}${Math.abs(constant)}`;
  }

  if (/d\d/.test(f)) {
    if (delta === 0) return f;
    return `${f}${delta > 0 ? '+' : '-'}${Math.abs(delta)}`;
  }

  return f;
}

/** Apply a flat adjustment to every part of a parsed expression. */
export function adjustDamageParts(parts, delta) {
  if (!delta) return parts;
  return parts.map((p) => ({ ...p, formula: adjustFormulaFlat(p.formula, delta) }));
}
