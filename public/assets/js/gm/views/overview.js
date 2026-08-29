/**
 * The cross-campaign view: which table has gone three weeks without me.
 */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';

const DAY = 86_400_000;

const parseStamp = (value) => (value ? new Date(`${String(value).replace(' ', 'T')}Z`) : null);

function relative(value, now) {
  const date = parseStamp(value);
  if (!date) return null;
  const days = Math.round((now - date) / DAY);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days > 0) return `${days} days ago`;
  return `in ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
}

export function overviewPanel(campaigns, { onOpen, now = Date.now() } = {}) {
  if (!campaigns.length) return el('div', { class: 'empty' }, 'No campaigns yet.');

  return el('div', { class: 'overview' }, ...campaigns.map((campaign) => {
    const lastPlayed = parseStamp(campaign.lastPlayedAt) ?? parseStamp(campaign.lastSheetEdit);
    const daysCold = lastPlayed ? Math.round((now - lastPlayed) / DAY) : null;
    // Three weeks is the line the brief draws, and it is the right one: a
    // fortnightly game that has missed one session is not yet a problem.
    const cold = daysCold !== null && daysCold >= 21 && !campaign.archivedAt;

    return el('article', {
      class: 'overview-card'
        + (cold ? ' overview-card--cold' : '')
        + (campaign.archivedAt ? ' overview-card--archived' : ''),
      dataset: { campaign: String(campaign.id) },
    },
    el('h3', {}, campaign.name),
    el('div', { class: 'overview-card__meta' },
      el('span', {}, `Level ${campaign.partyLevel}`),
      el('span', {}, `${campaign.characterCount} player${campaign.characterCount === 1 ? '' : 's'}`),
      el('span', {}, `${campaign.encounterCount} encounter${campaign.encounterCount === 1 ? '' : 's'}`)),
    campaign.adventure || campaign.chapter
      ? el('p', { class: 'muted' }, [campaign.adventure, campaign.chapter].filter(Boolean).join(' — '))
      : null,
    el('div', { class: 'overview-card__meta' },
      el('span', {}, `Last played ${relative(campaign.lastPlayedAt, now) ?? 'never'}`),
      campaign.nextSessionAt ? el('span', {}, `Next ${relative(campaign.nextSessionAt, now)}`) : null),
    cold ? el('span', { class: 'pill pill--warn' }, `${daysCold} days since this table played`) : null,
    campaign.archivedAt ? el('span', { class: 'pill' }, 'Archived') : null,
    el('button', {
      class: 'btn', type: 'button',
      html: `${icon('chevron')}<span>Open</span>`,
      onclick: () => onOpen?.(campaign.id),
    }));
  }));
}

/**
 * Per-campaign accents, as one constructed stylesheet.
 *
 * A rule per campaign is the only way to colour cards from data under a policy
 * with no `unsafe-inline`, which forbids the style attribute this would
 * otherwise be.
 */
let sheet = null;

export function applyAccents(campaigns) {
  if (typeof CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in document)) return;
  if (!sheet) {
    sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  const rules = campaigns
    .filter((c) => /^#[0-9a-f]{3,8}$/i.test(c.accentColor ?? ''))
    .map((c) => `[data-campaign="${c.id}"] { --card-accent: ${c.accentColor}; }`);
  sheet.replaceSync(rules.join('\n'));
}

/** The selected campaign's accent, which the whole chrome reads. */
let currentSheet = null;

export function applyCurrentAccent(color) {
  if (!/^#[0-9a-f]{3,8}$/i.test(color ?? '')) return;
  if (typeof CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in document)) return;
  if (!currentSheet) {
    currentSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, currentSheet];
  }
  currentSheet.replaceSync(`:root { --campaign-accent: ${color}; }`);
}
