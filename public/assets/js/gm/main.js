/**
 * The GM dashboard.
 *
 * Keyboard first, because the alternative at a table is hunting for a menu with
 * one hand while holding dice in the other. The campaign switcher is one
 * keystroke and always visible, and the accent colour it sets runs through the
 * whole chrome -- the failure this guards against is applying damage to the
 * wrong table's goblin at eleven at night.
 */
import { $, el, debounce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from './api.js';
import * as store from './state.js';
import { partyPanel } from './views/party.js';
import { applyAccents, applyCurrentAccent, overviewPanel } from './views/overview.js';
import { assignDisplayNames, builderView } from './views/builder.js';
import { statBlock } from './views/statblock.js';

const TABS = [
  ['table', 'Table', 'T'],
  ['encounters', 'Encounters', 'E'],
  ['overview', 'All campaigns', 'A'],
];

let searchQuery = { q: '', levelMin: null, levelMax: null, traits: [], rarity: null, size: null, source: null };
let searchResults = null;
let overview = [];
/** Names for creatures currently on screen, so display names can be generated. */
const creatureNames = new Map();

// --- theme ---------------------------------------------------------------

const THEME_KEY = 'off-guard:theme';

function fragment(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;

  const isLight = theme === 'light'
    || (!theme && matchMedia('(prefers-color-scheme: light)').matches);
  const button = $('#theme');
  button.setAttribute('aria-pressed', String(isLight));
  button.replaceChildren(
    fragment(icon(isLight ? 'moon' : 'sun')),
    Object.assign(document.createElement('span'), {
      className: 'sr-only',
      textContent: isLight ? 'Switch to the dark theme' : 'Switch to the light theme',
    }),
  );
  $('meta[name="theme-color"]').content = isLight ? '#F6F4FB' : '#1A1033';
}

function setUpTheme() {
  let stored = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch { /* private mode */ }
  applyTheme(stored);
  $('#theme').addEventListener('click', () => {
    const next = $('#theme').getAttribute('aria-pressed') === 'true' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
    applyTheme(next);
  });
}

// --- notices -------------------------------------------------------------

function notify(message, { kind = 'warn', actions = [] } = {}) {
  const host = $('#notices');
  const node = el('div', { class: 'notice' },
    el('div', { class: 'notice__body' },
      el('strong', {}, message),
      actions.length
        ? el('div', { class: 'notice__actions' }, ...actions.map(([label, fn]) => el('button', {
          class: 'btn', type: 'button', onclick: () => { fn(); node.remove(); },
        }, label)))
        : null),
    el('button', {
      class: 'btn btn--icon btn--quiet', type: 'button',
      html: `${icon('x')}<span class="sr-only">Dismiss</span>`,
      onclick: () => node.remove(),
    }));
  host.append(node);
  if (kind === 'info') setTimeout(() => node.remove(), 6000);
}

// --- the campaign switcher ------------------------------------------------

function renderSwitcher() {
  const { campaigns, campaignId } = store.get();
  const panel = $('#switcher-list');

  panel.replaceChildren(...campaigns.map((campaign) => {
    const item = el('button', {
      class: 'switcher__item', type: 'button', role: 'option',
      'aria-selected': String(campaign.id === campaignId),
      dataset: { campaign: String(campaign.id) },
      onclick: () => { selectCampaign(campaign.id); closeSwitcher(); },
    },
    el('span', { class: 'switcher__swatch', dataset: { campaign: String(campaign.id) } }),
    el('span', {},
      el('strong', {}, campaign.name),
      el('span', { class: 'switcher__meta' },
        [campaign.adventure, campaign.chapter, `Level ${campaign.partyLevel}`]
          .filter(Boolean).join(' · '))),
    campaign.archivedAt ? el('span', { class: 'pill' }, 'Archived') : null);
    return item;
  }));

  applyAccents(campaigns);
}

const openSwitcher = () => {
  $('#switcher').hidden = false;
  $('#campaign-switch').setAttribute('aria-expanded', 'true');
  $('#switcher-list').querySelector('[aria-selected="true"], button')?.focus();
};

const closeSwitcher = () => {
  $('#switcher').hidden = true;
  $('#campaign-switch').setAttribute('aria-expanded', 'false');
  $('#campaign-switch').focus();
};

// --- rendering ------------------------------------------------------------

function renderChrome() {
  const campaign = store.currentCampaign();
  $('#campaign-name').textContent = campaign?.name ?? 'No campaign';
  $('#campaign-swatch').dataset.campaign = campaign ? String(campaign.id) : '';
  if (campaign) applyCurrentAccent(campaign.accentColor);

  const { tab } = store.get();
  $('#tabs').replaceChildren(...TABS.map(([id, label, key]) => el('button', {
    class: 'tab', type: 'button',
    'aria-current': id === tab ? 'page' : null,
    onclick: () => selectTab(id),
  }, label, el('span', { class: 'tab__key' }, key))));
}

function render() {
  const state = store.get();
  renderChrome();

  const main = $('#main');

  if (state.tab === 'overview') {
    main.replaceChildren(
      el('div', { class: 'panels' },
        el('section', { class: 'panel' },
          el('div', { class: 'panel__head' },
            el('h2', { class: 'panel__title' }, 'All campaigns'),
            el('button', {
              class: 'btn', type: 'button',
              html: `${icon('plus')}<span>New campaign</span>`,
              onclick: newCampaign,
            })),
          overviewPanel(overview, {
            onOpen: (id) => { selectCampaign(id); selectTab('table'); },
          }))),
    );
    applyAccents(overview);
    return;
  }

  if (state.tab === 'encounters') {
    main.replaceChildren(builderView({
      results: searchResults,
      query: searchQuery,
      encounters: state.encounters,
      encounter: state.encounter,
      budget: state.budget,
      campaigns: state.campaigns,
      campaignId: state.campaignId,
      catalogue: state.catalogue,
      actions,
    }));
    return;
  }

  main.replaceChildren(el('div', { class: 'panels' }, partyPanel(state.party)));
}

// --- actions --------------------------------------------------------------

async function selectCampaign(id) {
  store.set({ campaignId: id, encounter: null, encounterId: null, budget: null });
  store.writeLocation({ campaignId: id, tab: store.get().tab });
  await Promise.all([loadParty(), loadEncounters()]);
  render();
}

function selectTab(tab) {
  store.set({ tab });
  store.writeLocation({ campaignId: store.get().campaignId, tab, encounterId: store.get().encounterId });
  if (tab === 'overview') loadOverview();
  if (tab === 'encounters' && !searchResults) actions.search(searchQuery);
  render();
}

async function loadParty() {
  const { campaignId } = store.get();
  if (!campaignId) return;
  try {
    store.set({ party: await api.party(campaignId) });
  } catch (error) {
    notify(`Could not load the party: ${error.message}`);
  }
}

async function loadEncounters() {
  const { campaignId } = store.get();
  if (!campaignId) return;
  try {
    store.set({ encounters: (await api.encounters(campaignId)).encounters });
  } catch (error) {
    notify(`Could not load encounters: ${error.message}`);
  }
}

async function loadOverview() {
  try {
    overview = (await api.overview()).campaigns;
    render();
  } catch (error) {
    notify(`Could not load the overview: ${error.message}`);
  }
}

async function loadBudget() {
  const { campaignId, encounter } = store.get();
  if (!campaignId || !encounter) return;
  try {
    store.set({ budget: await api.budget(campaignId, encounter.id) });
  } catch (error) {
    notify(`Could not price the encounter: ${error.message}`);
  }
  render();
}

/** Save the encounter's rows, then reprice. Every edit goes through here. */
const saveRows = debounce(async (rows) => {
  const { campaignId, encounter } = store.get();
  if (!encounter) return;
  try {
    const saved = await api.setCreatures(campaignId, encounter.id, rows);
    store.set({ encounter: saved.encounter });
    await loadBudget();
  } catch (error) {
    notify(`Could not save the encounter: ${error.message}`);
  }
}, 300);

function updateRows(mutate) {
  const { encounter } = store.get();
  if (!encounter) return;
  const next = assignDisplayNames(mutate([...encounter.creatures]), (id) => creatureNames.get(id));
  store.set({ encounter: { ...encounter, creatures: next } });
  render();
  saveRows(next);
}

const actions = {
  async search(query) {
    searchQuery = query;
    try {
      searchResults = await api.search({ ...query, limit: 60 });
      for (const row of searchResults.rows) creatureNames.set(row.id, row.name);
    } catch (error) {
      searchResults = { available: true, total: 0, rows: [] };
      notify(`Search failed: ${error.message}`);
    }
    render();
  },

  async preview(id, params = {}) {
    try {
      const { creature } = await api.creature(id, params);
      showStatBlock(creature);
    } catch (error) {
      notify(`Could not load that stat block: ${error.message}`);
    }
  },

  add(creatureId, count) {
    if (!store.get().encounter) {
      notify('Start an encounter first.', { actions: [['New encounter', () => actions.newEncounter()]] });
      return;
    }
    updateRows((rows) => {
      const existing = rows.findIndex((r) => r.creatureId === creatureId
        && !r.adjustment && !r.levelScale && !r.renamed);
      if (existing !== -1) {
        rows[existing] = { ...rows[existing], count: (rows[existing].count ?? 1) + count };
        return rows;
      }
      return [...rows, { creatureId, count, adjustment: null, levelScale: 0, displayName: '' }];
    });
  },

  updateRow(index, patch) {
    updateRows((rows) => {
      rows[index] = { ...rows[index], ...patch };
      return rows;
    });
  },

  removeRow(index) {
    updateRows((rows) => { rows.splice(index, 1); return rows; });
  },

  async newEncounter() {
    const { campaignId } = store.get();
    try {
      const { encounter } = await api.createEncounter(campaignId, { name: 'New encounter' });
      await loadEncounters();
      store.set({ encounter, encounterId: encounter.id, budget: null });
      render();
    } catch (error) {
      notify(`Could not create an encounter: ${error.message}`);
    }
  },

  async openEncounter(id) {
    const { campaignId } = store.get();
    if (!id) {
      store.set({ encounter: null, encounterId: null, budget: null });
      render();
      return;
    }
    try {
      const { encounter } = await api.encounter(campaignId, id);
      for (const row of encounter.creatures) {
        if (!creatureNames.has(row.creatureId)) {
          // Enough to regenerate display names without fetching every block.
          creatureNames.set(row.creatureId, row.displayName?.replace(/ [A-Z]$/, '') || row.creatureId);
        }
      }
      store.set({ encounter, encounterId: id });
      store.writeLocation({ campaignId, tab: 'encounters', encounterId: id });
      await loadBudget();
    } catch (error) {
      notify(`Could not open that encounter: ${error.message}`);
    }
  },

  async renameEncounter(name) {
    await actions.updateEncounter({ name });
  },

  async updateEncounter(fields) {
    const { campaignId, encounter } = store.get();
    if (!encounter) return;
    try {
      const { encounter: saved } = await api.updateEncounter(campaignId, encounter.id, fields);
      store.set({ encounter: { ...saved, creatures: encounter.creatures } });
      await loadEncounters();
      render();
    } catch (error) {
      notify(`Could not save: ${error.message}`);
    }
  },

  async deleteEncounter() {
    const { campaignId, encounter } = store.get();
    if (!encounter) return;
    const removed = { ...encounter };
    try {
      await api.deleteEncounter(campaignId, encounter.id);
      store.set({ encounter: null, encounterId: null, budget: null });
      await loadEncounters();
      render();
      // Every destructive action is undoable: the rows are still in memory, so
      // undo is a re-create rather than a soft delete nobody would clean up.
      notify(`Deleted “${removed.name}”.`, {
        actions: [['Undo', async () => {
          const { encounter: restored } = await api.createEncounter(campaignId, removed);
          if (removed.creatures.length) {
            await api.setCreatures(campaignId, restored.id, removed.creatures);
          }
          await loadEncounters();
          await actions.openEncounter(restored.id);
        }]],
      });
    } catch (error) {
      notify(`Could not delete: ${error.message}`);
    }
  },

  async copyEncounter(toCampaignId) {
    const { campaignId, encounter } = store.get();
    try {
      const preview = await api.reprice(campaignId, encounter.id, toCampaignId);
      await api.copyEncounter(campaignId, encounter.id, toCampaignId);
      await loadEncounters();
      const message = preview.bandChanged
        ? `Copied to ${preview.toCampaign.name}. Difficulty moves from `
          + `${preview.before.difficulty ?? 'unrated'} to ${preview.after.difficulty ?? 'unrated'}.`
        : `Copied to ${preview.toCampaign.name}. Difficulty is unchanged.`;
      notify(message, { kind: preview.bandChanged ? 'warn' : 'info' });
    } catch (error) {
      notify(`Could not copy: ${error.message}`);
    }
  },

  exportEncounter() {
    const { encounter } = store.get();
    if (!encounter) return;
    const payload = {
      name: encounter.name,
      notes: encounter.notes,
      terrain: encounter.terrain,
      lighting: encounter.lighting,
      treasure: encounter.treasure,
      creatures: encounter.creatures.map((row) => ({
        creatureId: row.creatureId,
        displayName: row.displayName,
        adjustment: row.adjustment,
        levelScale: row.levelScale,
        count: row.count,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `${encounter.name.replace(/[^\w -]/g, '')}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};

async function newCampaign() {
  const name = prompt('Name for the new campaign?');
  if (!name) return;
  try {
    const { campaign } = await api.createCampaign({ name });
    store.set({ campaigns: [...store.get().campaigns, campaign] });
    renderSwitcher();
    await loadOverview();
    selectCampaign(campaign.id);
  } catch (error) {
    notify(`Could not create the campaign: ${error.message}`);
  }
}

function showStatBlock(creature) {
  const existing = $('#statblock-dialog');
  existing?.remove();
  const dialog = el('dialog', { class: 'dialog', id: 'statblock-dialog' },
    el('button', {
      class: 'btn btn--icon btn--quiet dialog__close', type: 'button',
      html: `${icon('x')}<span class="sr-only">Close</span>`,
      onclick: () => dialog.close(),
    }),
    statBlock(creature));
  document.body.append(dialog);
  dialog.showModal();
}

// --- keyboard --------------------------------------------------------------

function setUpKeyboard() {
  addEventListener('keydown', (event) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === 'Escape' && !$('#switcher').hidden) { closeSwitcher(); return; }

    const key = event.key.toLowerCase();
    if (key === 'c') { event.preventDefault(); openSwitcher(); return; }

    const tab = TABS.find(([, , shortcut]) => shortcut.toLowerCase() === key);
    if (tab) { event.preventDefault(); selectTab(tab[0]); return; }

    // Number keys jump straight to a campaign, which is the actual gesture:
    // "put me on the Tuesday game" rather than "open a menu".
    const index = Number(event.key) - 1;
    if (Number.isInteger(index) && index >= 0) {
      const campaign = store.get().campaigns[index];
      if (campaign) { event.preventDefault(); selectCampaign(campaign.id); }
    }
  });

  $('#campaign-switch').addEventListener('click', openSwitcher);
  $('#switcher').addEventListener('click', (event) => {
    if (event.target === $('#switcher')) closeSwitcher();
  });
}

// --- start -----------------------------------------------------------------

async function start() {
  setUpTheme();
  setUpKeyboard();

  const [{ campaigns }, catalogue] = await Promise.all([
    api.campaigns(),
    api.catalogue().catch(() => ({ available: false })),
  ]);

  let vocabulary = { traits: [], sources: [] };
  if (catalogue.available) {
    vocabulary = await api.vocabulary().catch(() => vocabulary);
  }

  store.set({ campaigns, catalogue: { ...catalogue, ...vocabulary } });
  renderSwitcher();

  const wanted = store.readLocation();
  // Failing an explicit choice in the URL, open the table played most recently.
  // Alphabetical order would put whichever campaign starts with an A in front
  // of the game that was running last night.
  const mostRecent = [...campaigns]
    .filter((c) => !c.archivedAt)
    .sort((a, b) => String(b.lastPlayedAt ?? '').localeCompare(String(a.lastPlayedAt ?? '')))[0];
  const active = campaigns.find((c) => c.id === wanted.campaignId) ?? mostRecent ?? campaigns[0];

  $('#loading')?.remove();

  if (!active) {
    store.set({ tab: 'overview' });
    await loadOverview();
    render();
    return;
  }

  store.set({ tab: wanted.tab ?? 'table' });
  await selectCampaign(active.id);
  if (wanted.encounterId) await actions.openEncounter(wanted.encounterId);
  if (store.get().tab === 'overview') await loadOverview();
  render();
}

start().catch((error) => {
  $('#loading')?.remove();
  notify(`Could not start: ${error.message}`);
});
