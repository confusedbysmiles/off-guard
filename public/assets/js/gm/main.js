/**
 * The GM dashboard.
 *
 * Wiring only. The store owns the data, `actions.js` owns everything the
 * dashboard does, the modules under `views/` own the DOM, and this file connects
 * them and handles what belongs to the page itself: routing, the keyboard, the
 * campaign switcher and the dialogs.
 *
 * Keyboard first, because the alternative at a table is hunting for a menu with
 * one hand while holding dice in the other.
 */
import { $, el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { setUpTheme } from '../lib/theme.js';
import { createNotices } from '../lib/notices.js';
import { api } from './api.js';
import * as store from './state.js';
import { createActions } from './actions.js';
import { partyPanel } from './views/party.js';
import { applyAccents, applyCurrentAccent, overviewPanel } from './views/overview.js';
import { builderView } from './views/builder.js';
import { initiativeView, persistentDamageForm, promptList } from './views/initiative.js';
import { statBlock } from './views/statblock.js';
import { linkReveal, linksPanel } from './views/links.js';
import { createDrawer, drawerShell } from './drawer.js';

const TABS = [
  ['table', 'Table', 'T'],
  ['initiative', 'Initiative', 'I'],
  ['encounters', 'Encounters', 'E'],
  ['overview', 'All campaigns', 'A'],
];

const notices = createNotices($('#notices'));

// The drawer lives outside `#main` so a dashboard re-render does not close it.
document.body.insertBefore(drawerShell(), $('.gm-footer'));

function fragment(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

// --- dialogs ---------------------------------------------------------------

function showDialog(id, ...content) {
  document.getElementById(id)?.remove();
  const dialog = el('dialog', { class: 'dialog', id },
    el('button', {
      class: 'btn btn--icon btn--quiet dialog__close', type: 'button',
      html: `${icon('x')}<span class="sr-only">Close</span>`,
      onclick: () => dialog.close(),
    }),
    ...content);
  // Closing a <dialog> hides it; it does not remove it. Left in the document,
  // a dismissed link dialog keeps the token it showed in the page's markup --
  // which is the opposite of showing it once -- and the next dialog's fields
  // are no longer the first match for their own selectors.
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

const showStatBlock = (creature) => showDialog('statblock-dialog', statBlock(creature));

/**
 * Show a freshly minted link, once.
 *
 * `final` marks the case where the token this page runs on has just been
 * replaced: every further request from this tab will 404, so the dialog is not
 * dismissable into a dashboard that no longer works.
 */
function showLink(kind, token, subject, { final = false } = {}) {
  const dialog = showDialog('link-dialog', linkReveal(kind, token, { subject }));
  if (final) {
    dialog.querySelector('.dialog__close')?.remove();
    dialog.append(el('p', { class: 'muted stack-md' },
      'This tab is now signed out. Open the link above to carry on.'));
    dialog.addEventListener('cancel', (event) => event.preventDefault());
  }
  dialog.querySelector('.link-reveal__url')?.focus();
}

function showPersistentDamage(combatant) {
  const dialog = showDialog('persistent-dialog', persistentDamageForm(combatant, {
    onAdd: (entry) => {
      actions.updateCombatant(combatant.id, {
        persistentDamage: [...(combatant.persistentDamage ?? []), entry],
      });
      dialog.close();
    },
  }));
  dialog.querySelector('#pd-formula')?.focus();
}

const showPrompts = (prompts) => showDialog('prompt-dialog',
  el('h2', {}, 'The turn ended'),
  el('p', { class: 'muted' },
    'Applied what the rules state outright. Everything else is here because it '
    + 'depends on something only you know.'),
  promptList(prompts, actions));

// --- the dashboard's own callbacks -----------------------------------------

const actions = createActions({
  api, store, notices, refresh: render, showStatBlock, showPrompts, showLink,
});

const drawer = createDrawer({ store, actions, notices });

// --- the campaign switcher --------------------------------------------------

function renderSwitcher() {
  const { campaigns, campaignId } = store.get();
  $('#switcher-list').replaceChildren(...campaigns.map((campaign) => el('button', {
    class: 'switcher__item', type: 'button',
    'aria-current': campaign.id === campaignId ? 'true' : null,
    dataset: { campaign: String(campaign.id) },
    onclick: () => { closeSwitcher(); selectCampaign(campaign.id); },
  },
  el('span', { class: 'switcher__swatch', dataset: { campaign: String(campaign.id) } }),
  el('span', {},
    el('strong', {}, campaign.name),
    el('span', { class: 'switcher__meta' },
      [campaign.adventure, campaign.chapter, `Level ${campaign.partyLevel}`]
        .filter(Boolean).join(' · '))),
  campaign.archivedAt ? el('span', { class: 'pill' }, 'Archived') : null)));

  applyAccents(campaigns);
}

function openSwitcher() {
  $('#switcher').hidden = false;
  $('#campaign-switch').setAttribute('aria-expanded', 'true');
  $('#switcher-list').querySelector('[aria-current="true"], button')?.focus();
}

function closeSwitcher() {
  $('#switcher').hidden = true;
  $('#campaign-switch').setAttribute('aria-expanded', 'false');
  $('#campaign-switch').focus();
}

// --- rendering ---------------------------------------------------------------

function renderChrome() {
  const campaign = store.currentCampaign();
  $('#campaign-name').textContent = campaign?.name ?? 'No campaign';
  $('#campaign-swatch').dataset.campaign = campaign ? String(campaign.id) : '';
  if (campaign) applyCurrentAccent(campaign.accentColor);

  const { tab, combat } = store.get();
  $('#tabs').replaceChildren(...TABS.map(([id, label, key]) => el('button', {
    class: 'tab', type: 'button',
    'aria-current': id === tab ? 'page' : null,
    onclick: () => selectTab(id),
  },
  label,
  // A running fight is worth knowing about from any tab.
  id === 'initiative' && combat ? el('span', { class: 'tab__dot' }, '') : null,
  el('span', { class: 'tab__key' }, key))));
}

function render() {
  const state = store.get();
  renderChrome();
  const main = $('#main');

  if (state.tab === 'overview') {
    main.replaceChildren(el('div', { class: 'panels' },
      el('section', { class: 'panel' },
        el('div', { class: 'panel__head' },
          el('h2', { class: 'panel__title' }, 'All campaigns'),
          el('button', {
            class: 'btn', type: 'button',
            html: `${icon('plus')}<span>New campaign</span>`,
            onclick: async () => {
              const created = await actions.newCampaign(prompt('Name for the new campaign?'));
              if (created) { renderSwitcher(); selectCampaign(created.id); }
            },
          })),
        overviewPanel(state.overview, {
          onOpen: (id) => { selectCampaign(id); selectTab('table'); },
        }))));
    applyAccents(state.overview);
    return;
  }

  if (state.tab === 'initiative') {
    main.replaceChildren(initiativeView({
      combat: state.combat,
      encounters: state.encounters,
      party: state.party,
      actions,
      onRecall: (combatant) => drawer.recall(combatant.id, `Asked about ${combatant.displayName}.`),
      onPersistent: showPersistentDamage,
    }));
    setUpDragToReorder();
    return;
  }

  if (state.tab === 'encounters') {
    main.replaceChildren(builderView({
      results: state.searchResults,
      query: actions.searchQuery,
      encounters: state.encounters,
      encounter: state.encounter,
      budget: state.budget,
      campaigns: state.campaigns,
      campaignId: state.campaignId,
      catalogue: state.catalogue,
      actions,
    }));
    setUpEncounterFileInput();
    return;
  }

  main.replaceChildren(el('div', { class: 'panels' },
    partyPanel(state.party),
    state.tokens
      ? linksPanel({
        tokens: state.tokens,
        characters: state.party?.characters ?? [],
        actions,
      })
      : null));
}

/** Dragging a row is how a tie gets broken; the rules give no tiebreak. */
function setUpDragToReorder() {
  const list = $('#initiative-list');
  if (!list) return;
  let dragging = null;

  list.addEventListener('dragstart', (event) => {
    dragging = event.target.closest('.combatant');
    dragging?.classList.add('combatant--dragging');
    event.dataTransfer.effectAllowed = 'move';
  });

  list.addEventListener('dragend', () => {
    dragging?.classList.remove('combatant--dragging');
    dragging = null;
  });

  list.addEventListener('dragover', (event) => {
    if (!dragging) return;
    event.preventDefault();
    const over = event.target.closest('.combatant');
    if (!over || over === dragging) return;
    const { top, height } = over.getBoundingClientRect();
    const after = event.clientY > top + height / 2;
    list.insertBefore(dragging, after ? over.nextSibling : over);
  });

  list.addEventListener('drop', (event) => {
    event.preventDefault();
    actions.reorder([...list.children].map((node) => Number(node.dataset.combatant)));
  });
}

function setUpEncounterFileInput() {
  const input = el('input', {
    type: 'file', accept: 'application/json,.json', id: 'encounter-import',
    class: 'sr-only',
    onchange: (event) => {
      const file = event.target.files?.[0];
      if (file) actions.importEncounter(file);
      event.target.value = '';
    },
  });
  const label = el('label', { class: 'btn', for: 'encounter-import' },
    fragment(icon('upload')), el('span', {}, 'Import'));
  $('.panel__head .row-inline')?.append(input, label);
}

// --- routing ------------------------------------------------------------------

async function selectCampaign(id) {
  // The dice log and any open Recall Knowledge belong to the campaign being
  // left. Clearing them here is the same rule the accent colour exists for:
  // nothing from Tuesday's game may still be on screen once Saturday's is.
  store.set({
    campaignId: id, encounter: null, encounterId: null, budget: null, combat: null,
    rolls: [], recall: null,
  });
  store.writeLocation({ campaignId: id, tab: store.get().tab });
  await Promise.all([
    actions.loadParty(), actions.loadEncounters(), actions.loadCombat(),
    actions.loadRolls(), actions.loadTokens(),
  ]);
  render();
  drawer.render();
}

function selectTab(tab) {
  const { campaignId, encounterId } = store.get();
  store.set({ tab });
  store.writeLocation({ campaignId, tab, encounterId });
  if (tab === 'overview') actions.loadOverview().then(render);
  if (tab === 'encounters' && !store.get().searchResults) actions.search(actions.searchQuery);
  render();
}

// --- keyboard -------------------------------------------------------------------

function setUpKeyboard() {
  addEventListener('keydown', (event) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === 'Escape' && !$('#switcher').hidden) { closeSwitcher(); return; }
    if (event.key === 'Escape' && drawer.isOpen()) { drawer.close(); return; }

    const key = event.key.toLowerCase();

    // The drawer, from anywhere. R and D open it; K asks about whoever's turn
    // it is, which is the creature a player has just asked about.
    if (key === 'r') { event.preventDefault(); drawer.toggle('reference'); return; }
    if (key === 'd') { event.preventDefault(); drawer.toggle('dice'); return; }
    if (key === 'k') {
      event.preventDefault();
      const { combat } = store.get();
      const current = combat?.combatants[combat.turnIndex];
      if (current && !current.characterId) {
        drawer.recall(current.id, `Asked about ${current.displayName}.`);
      } else {
        drawer.toggle('recall');
      }
      return;
    }

    // Turn advance, which is the key pressed most often in a session.
    if (store.get().tab === 'initiative') {
      if (event.key === ' ' || key === 'n') { event.preventDefault(); actions.advance(1); return; }
      if (key === 'p') { event.preventDefault(); actions.advance(-1); return; }
    }

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

// --- start -----------------------------------------------------------------------

async function start() {
  setUpTheme($('#theme'), (isLight) => {
    $('#theme').replaceChildren(
      fragment(icon(isLight ? 'moon' : 'sun')),
      Object.assign(document.createElement('span'), {
        className: 'sr-only',
        textContent: isLight ? 'Switch to the dark theme' : 'Switch to the light theme',
      }),
    );
  });
  setUpKeyboard();

  const [{ campaigns }, catalogue] = await Promise.all([
    api.campaigns(),
    api.catalogue().catch(() => ({ available: false })),
  ]);

  const vocabulary = catalogue.available
    ? await api.vocabulary().catch(() => ({ traits: [], sources: [] }))
    : { traits: [], sources: [] };

  store.set({ campaigns, catalogue: { ...catalogue, ...vocabulary } });
  renderSwitcher();

  const wanted = store.readLocation();
  // Failing an explicit choice in the URL, open the table played most recently.
  // Alphabetical order would put whichever campaign starts with an A in front of
  // the game that was running last night.
  const mostRecent = [...campaigns]
    .filter((c) => !c.archivedAt)
    .sort((a, b) => String(b.lastPlayedAt ?? '').localeCompare(String(a.lastPlayedAt ?? '')))[0];
  const active = campaigns.find((c) => c.id === wanted.campaignId) ?? mostRecent ?? campaigns[0];

  $('#loading')?.remove();

  if (!active) {
    store.set({ tab: 'overview' });
    await actions.loadOverview();
    render();
    return;
  }

  store.set({ tab: wanted.tab ?? 'table' });
  await selectCampaign(active.id);
  if (wanted.encounterId) await actions.openEncounter(wanted.encounterId);
  if (store.get().tab === 'overview') await actions.loadOverview();
  render();
}

start().catch((error) => {
  $('#loading')?.remove();
  notices.error(`Could not start: ${error.message}`);
});
