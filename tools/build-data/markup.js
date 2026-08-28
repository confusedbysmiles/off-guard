/**
 * Resolver for Foundry's inline markup.
 *
 * Foundry stat block text is HTML sprinkled with `@UUID[]`, `@Damage[]`,
 * `@Check[]`, `@Template[]`, `@Localize[]` and `[[/r]]`-style inline rolls. None
 * of it is readable as-is, and some of it (`@Localize`) is a *pointer* to text
 * that lives in the system's lang file rather than the creature record.
 *
 * This runs at build time only. It emits a RichText value:
 *
 *   { html, text, damage[], checks[], links[], gmOnly }
 *
 * `html` carries `<span class="og-dmg" data-og-dmg="N">` / `data-og-chk="N"`
 * markers pointing into the `damage` and `checks` arrays. The rules engine
 * adjusts those array entries for elite/weak and the view re-renders the marked
 * spans in place, so no downstream code ever has to parse rendered HTML.
 */

import {
  parseDamageExpression,
  renderDamageParts,
} from '../../src/shared/damage-expression.js';
import { parseCheckPayload, renderCheck } from '../../src/shared/check-expression.js';

// Tags actually present in the corpus (surveyed across all 6,392 NPC records),
// minus the handful we refuse to carry: div, section, a, and a stray <deity>.
const ALLOWED_TAGS = new Set([
  'p', 'strong', 'em', 'hr', 'br', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h2', 'h3', 'h4', 'span',
]);
const VOID_TAGS = new Set(['hr', 'br']);


const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const titleCase = (s) =>
  String(s).replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());

export const slugify = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Strip everything we do not explicitly allow, and drop all attributes except
 * Foundry's `data-visibility="gm"`, which marks text the players must not see.
 * Runs *before* token resolution so our own generated markup is never sanitized.
 */
function sanitizeHtml(raw) {
  let sawGmOnly = false;
  const html = String(raw ?? '').replace(
    /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)\s*>/g,
    (_all, closing, rawName, attrs, selfClose) => {
      const name = rawName.toLowerCase();
      if (!ALLOWED_TAGS.has(name)) return '';
      if (VOID_TAGS.has(name)) return closing ? '' : `<${name}>`;
      if (closing) return `</${name}>`;
      if (name === 'span' && /data-visibility\s*=\s*["']gm["']/i.test(attrs)) {
        sawGmOnly = true;
        return '<span class="og-gm-only">';
      }
      if (selfClose) return `<${name}></${name}>`;
      return `<${name}>`;
    }
  );
  return { html, gmOnly: sawGmOnly };
}

/** Index of the character after the balanced group starting at `open`, or -1. */
function endOfBalanced(str, open, openCh, closeCh) {
  if (str[open] !== openCh) return -1;
  let depth = 0;
  for (let i = open; i < str.length; i += 1) {
    if (str[i] === openCh) depth += 1;
    else if (str[i] === closeCh) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Read an optional `{label}` immediately following `i`. */
function readLabel(str, i) {
  if (str[i] !== '{') return { label: null, next: i };
  const end = endOfBalanced(str, i, '{', '}');
  if (end === -1) return { label: null, next: i };
  return { label: str.slice(i + 1, end - 1), next: end };
}

/** Parse `reflex|dc:29|basic|options:area-effect` into a structured check. */
/**
 * `emanation|distance:30` -> `30-foot emanation`.
 *
 * Upstream uses two spellings for the shape: a bare leading segment
 * (`cone|distance:60`) and a legacy keyed one (`type:cone|distance:60`).
 * Both appear in current packs, so only treat the leading segment as the
 * shape when it is not itself a `key:value` pair.
 */
function renderTemplate(payload) {
  const segments = String(payload).split('|');
  let shape = '';
  if (segments.length && !segments[0].includes(':')) shape = (segments.shift() ?? '').trim();
  const params = {};
  for (const seg of segments) {
    const idx = seg.indexOf(':');
    if (idx !== -1) params[seg.slice(0, idx).trim()] = seg.slice(idx + 1).trim();
  }
  const shapeName = (params.type ?? shape).toLowerCase();
  const distance = params.distance ?? params.value;
  const width = params.width ? `${params.width}-foot-wide ` : '';
  return distance ? `${width}${distance}-foot ${shapeName}` : `${width}${shapeName}`;
}

/**
 * Substitute the runtime references Foundry resolves against live actor data.
 * `@item.level` and `@item.rank` appear in ~1,000 damage formulas; without a
 * substitution they would render as literal `@item.level` on the stat block.
 * Anything we cannot resolve is left symbolic rather than guessed at.
 */
function resolveRuntimeRefs(formula, ctx) {
  let out = String(formula);
  const substitutions = {
    '@item.level': ctx.level,
    '@item.rank': ctx.rank,
    '@actor.level': ctx.level,
    '@actor.details.level.value': ctx.level,
  };
  for (const [ref, value] of Object.entries(substitutions)) {
    if (value === null || value === undefined) continue;
    out = out.split(ref).join(String(value));
  }
  // Fold the arithmetic the substitution just made resolvable: `(5+1)d8` -> `6d8`.
  out = out.replace(/\((\d+)\s*([+-])\s*(\d+)\)/g, (all, a, op, b) => {
    const n = op === '+' ? Number(a) + Number(b) : Number(a) - Number(b);
    return String(n);
  });
  out = out.replace(/^\((\d+)\)$/, '$1');
  return out;
}

/**
 * `@Check[reflex|dc:41|basic]` is written in the source with the word "save"
 * following it in prose ("... @Check[reflex|dc:41|basic] save)") because
 * Foundry's own renderer stops at "DC 41 basic Reflex". We render the fuller
 * "DC 41 basic Reflex save" so a check reads correctly on its own, which means
 * dropping the prose copy that would otherwise double it.
 */
function collapseSaveLabel(html) {
  return String(html).replace(
    /(<span class="og-chk"[^>]*>[^<]*\bsave<\/span>)\s*(?:saving throws?|saves?)\b/gi,
    '$1',
  );
}

export function createMarkupResolver({ uuidIndex = new Map(), glossary = new Map() } = {}) {
  /**
   * @param {string} raw   Foundry HTML.
   * @param {object} ctx   `{ level, rank, source }` for runtime refs and diagnostics.
   */
  function resolve(raw, ctx = {}) {
    const damage = [];
    const checks = [];
    const links = [];
    const unresolved = [];

    const { html: sanitized, gmOnly } = sanitizeHtml(raw);
    const html = normalizeParagraphs(collapseSaveLabel(walk(sanitized, ctx, 0)));

    function pushDamage(payload, label) {
      const parsed = parseDamageExpression(payload);
      const parts = parsed.parts.map((p) => ({
        ...p,
        formula: resolveRuntimeRefs(p.formula, ctx),
      }));
      const index = damage.length;
      damage.push({ parts, options: parsed.options });
      const text = label ?? renderDamageParts(parts);
      return `<span class="og-dmg" data-og-dmg="${index}">${escapeHtml(text)}</span>`;
    }

    function pushCheck(payload, label) {
      const check = parseCheckPayload(payload);
      const index = checks.length;
      checks.push(check);
      const text = check.dc === null && label ? label : renderCheck(check);
      return `<span class="og-chk" data-og-chk="${index}">${escapeHtml(text)}</span>`;
    }

    function pushLink(uuid, label) {
      const target = lookupUuid(uuidIndex, uuid);
      const text = label ?? target?.name ?? lastUuidSegment(uuid);
      if (!target) {
        unresolved.push(uuid);
        return `<span class="og-ref og-ref--unresolved">${escapeHtml(text)}</span>`;
      }
      links.push({ kind: target.kind, id: target.id, label: text });
      return `<a class="og-ref" href="#/ref/${target.kind}/${target.id}">${escapeHtml(text)}</a>`;
    }

    function walk(str, context, depth) {
      let out = '';
      let i = 0;
      while (i < str.length) {
        const ch = str[i];

        if (ch === '@') {
          const match = /^@(UUID|Damage|Check|Template|Localize)\[/.exec(str.slice(i));
          if (match) {
            const bracketStart = i + match[0].length - 1;
            const bracketEnd = endOfBalanced(str, bracketStart, '[', ']');
            if (bracketEnd !== -1) {
              const payload = str.slice(bracketStart + 1, bracketEnd - 1);
              const { label, next } = readLabel(str, bracketEnd);
              out += renderToken(match[1], payload, label, context, depth);
              i = next;
              continue;
            }
          }
        }

        if (ch === '[' && str.startsWith('[[', i)) {
          const close = str.indexOf(']]', i);
          if (close !== -1) {
            const payload = str.slice(i + 2, close);
            const { label, next } = readLabel(str, close + 2);
            out += renderInlineRoll(payload, label);
            i = next;
            continue;
          }
        }

        out += ch;
        i += 1;
      }
      return out;
    }

    function renderToken(kind, payload, label, context, depth) {
      switch (kind) {
        case 'UUID': return pushLink(payload, label);
        case 'Damage': return pushDamage(payload, label);
        case 'Check': return pushCheck(payload, label);
        case 'Template': return escapeHtml(label ?? renderTemplate(payload));
        case 'Localize': {
          if (depth > 4) return '';
          const entry = glossary.get(payload.trim());
          if (entry === undefined) {
            unresolved.push(payload.trim());
            return '';
          }
          return walk(sanitizeHtml(entry).html, context, depth + 1);
        }
        default: return '';
      }
    }

    /** `[[/r 2d6 #flavor]]`, `[[/br ...]]`, `[[/gmr ...]]`, `[[/act demoralize]]`. */
    function renderInlineRoll(payload, label) {
      const body = payload.trim();
      const cmd = (/^\/([a-z]+)/.exec(body) ?? [])[1] ?? '';
      const rest = body.slice(cmd.length + 1).trim();
      if (cmd === 'act') {
        const [slug] = rest.split(/\s+/);
        return pushLink(`Compendium.pf2e.actionspf2e.Item.${titleCase(slug)}`, label ?? titleCase(slug));
      }
      const [formula, flavor] = rest.split('#').map((s) => s.trim());
      if (label) return escapeHtml(label);
      const suffix = flavor ? ` (${flavor})` : '';
      const prefix = cmd === 'gmr' || cmd === 'br' ? '' : '';
      return escapeHtml(`${prefix}${formula}${suffix}`);
    }

    return {
      html: html.trim(),
      text: htmlToText(html),
      damage,
      checks,
      links,
      gmOnly,
      unresolved,
    };
  }

  /** Look up a localization key (IWR exception labels, glossary strings). */
  const localize = (key) => glossary.get(String(key)) ?? null;

  return { resolve, localize };
}

/**
 * Inlining a glossary entry drops a `<p>...</p><hr /><p>...</p>` block inside the
 * `<p>` that held the `@Localize` token, which is invalid nesting. Flatten it:
 * a block-level start tag implicitly closes an open paragraph.
 */
const BLOCK_TAGS = new Set(['p', 'hr', 'ul', 'ol', 'table', 'h2', 'h3', 'h4']);

export function normalizeParagraphs(html) {
  let out = '';
  let inParagraph = false;
  let i = 0;
  const str = String(html);
  while (i < str.length) {
    const lt = str.indexOf('<', i);
    if (lt === -1) { out += str.slice(i); break; }
    out += str.slice(i, lt);
    const gt = str.indexOf('>', lt);
    if (gt === -1) { out += str.slice(lt); break; }
    const tag = str.slice(lt, gt + 1);
    const m = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(tag);
    const closing = m?.[1] === '/';
    const name = (m?.[2] ?? '').toLowerCase();

    if (name === 'p' && !closing) {
      if (inParagraph) out += '</p>';
      out += '<p>';
      inParagraph = true;
    } else if (name === 'p' && closing) {
      if (inParagraph) { out += '</p>'; inParagraph = false; }
    } else if (!closing && BLOCK_TAGS.has(name)) {
      if (inParagraph) { out += '</p>'; inParagraph = false; }
      out += tag;
    } else {
      out += tag;
    }
    i = gt + 1;
  }
  if (inParagraph) out += '</p>';
  return out.replace(/<p>\s*<\/p>/g, '').trim();
}

function lastUuidSegment(uuid) {
  const parts = String(uuid).split('.');
  return parts[parts.length - 1] ?? uuid;
}

/**
 * Foundry UUIDs come in two shapes, both present in the corpus:
 *   Compendium.pf2e.conditionitems.Item.Frightened          (by name)
 *   Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei    (by id)
 * The id form shows up inside the localized glossary strings.
 */
function lookupUuid(index, uuid) {
  const segments = String(uuid).split('.');
  const key = segments[segments.length - 1];
  const pack = segments.length >= 3 ? segments[segments.length - 3] : null;
  return (
    index.get(`${pack}:${key}`) ??
    index.get(`${pack}:${slugify(key)}`) ??
    index.get(`id:${key}`) ??
    index.get(`name:${slugify(key)}`) ??
    null
  );
}

/** Plain-text projection: used for search and for anywhere HTML cannot go. */
export function htmlToText(html) {
  return String(html)
    .replace(/<\s*(p|hr|br|li|tr|h2|h3|h4)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export { sanitizeHtml, renderTemplate, resolveRuntimeRefs };
export { parseCheckPayload, renderCheck } from '../../src/shared/check-expression.js';
