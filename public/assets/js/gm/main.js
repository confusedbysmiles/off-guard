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
import { makeSortable } from '../lib/reorder.js';
import { preservingFocus } from '../lib/focus.js';
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
import { campaignPanel, rosterPanel, sessionsPanel } from './views/campaign.js';
import { createDrawer, drawerShell } from './drawer.js';
import { startPanel } from './views/start.js';
import { loopView } from './views/loop.js';
import { ADVENTURE as NINE_MINUTES } from './adventures/nine-minutes.js';
import { shortcutFor, TABS } from './shortcuts.js';
import { blankState } from '../../../engine/shared/loop.js';

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

/**
 * Rebuild the open tab.
 *
 * Wrapped in `preservingFocus` as a whole rather than in each branch: any panel
 * with a field in it can be re-rendered while the GM is typing into it, and
 * search was only the one that did it on every keystroke.
 */
function render(...args) {
  preservingFocus(() => renderNow(...args));
}

function renderNow() {
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
      combat: state.combat,
      actions,
      onRun: () => selectTab('initiative'),
    }));
    setUpEncounterFileInput();
    setUpEncounterReorder();
    setUpCreatureReorder();
    return;
  }

  if (state.tab === 'loop') {
    main.replaceChildren(loopView({
      adventure: state.loopAdventure ?? NINE_MINUTES,
      run: state.loopRun,
      state: state.loopState ?? blankState(NINE_MINUTES),
      actions,
    }));
    return;
  }

  if (state.tab === 'setup') {
    main.replaceChildren(el('div', { class: 'panels' },
      campaignPanel({ campaign: store.currentCampaign(), actions }),
      rosterPanel({ characters: state.party?.characters ?? [], actions }),
      state.tokens
        ? linksPanel({
          tokens: state.tokens,
          characters: state.party?.characters ?? [],
          actions,
        })
        : null,
      sessionsPanel({ sessions: state.sessions, actions })));
    return;
  }

  if (state.tab === 'start') {
    main.replaceChildren(startPanel(state, { onTab: selectTab }));
    return;
  }

  main.replaceChildren(el('div', { class: 'panels' }, partyPanel(state.party)));
}

/** Dragging a row is how a tie gets broken; the rules give no tiebreak. */
function setUpDragToReorder() {
  makeSortable($('#initiative-list'), {
    key: 'combatant',
    itemSelector: '.combatant',
    onDrop: (order) => actions.reorder(order),
  });
}

/** The order encounters are planned in, which is the order a session runs. */
function setUpEncounterReorder() {
  makeSortable($('#encounter-list'), {
    key: 'encounter',
    itemSelector: '.encounter-item',
    onDrop: (order) => actions.reorderEncounters(order),
  });
}

/** The order creatures sit in within one encounter. */
function setUpCreatureReorder() {
  makeSortable($('#encounter-rows'), {
    key: 'row',
    itemSelector: '.encounter-row',
    onDrop: (order) => actions.reorderRows(order),
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
    rolls: [], recall: null, sessions: [], tokens: null,
    // Same rule: a loop run belongs to the campaign being left. Tuesday's
    // seventh loop must not be on screen under Saturday's name.
    loopAdventure: null, loopRun: null, loopState: null,
  });
  store.writeLocation({ campaignId: id, tab: store.get().tab });
  await Promise.all([
    actions.loadParty(), actions.loadEncounters(), actions.loadCombat(),
    actions.loadRolls(), actions.loadTokens(), actions.loadSessions(),
  ]);
  if (store.get().tab === 'loop') await actions.loadLoop(NINE_MINUTES);
  render();
  drawer.render();
}

function selectTab(tab) {
  const { campaignId, encounterId } = store.get();
  store.set({ tab });
  store.writeLocation({ campaignId, tab, encounterId });
  if (tab === 'overview') actions.loadOverview().then(render);
  // Loaded on arrival rather than with the campaign: most tables are not
  // running a looping adventure, and a fetch per campaign switch for a tab
  // nobody opened is a request that buys nothing.
  if (tab === 'loop' && !store.get().loopState) actions.loadLoop(NINE_MINUTES);
  if (tab === 'encounters' && !store.get().searchResults) actions.search(actions.searchQuery);
  render();
}

// --- keyboard -------------------------------------------------------------------

/**
 * What each shortcut in `shortcuts.js` does.
 *
 * Keyed by the same ids, so the table that documents the keyboard is the table
 * that drives it. A test holds the two together in both directions.
 */
export const SHORTCUT_ACTIONS = {
  ...Object.fromEntries(TABS.map(([id]) => [`tab:${id}`, () => selectTab(id)])),

  'campaign:switcher': () => openSwitcher(),

  // Handled by the digit branch below, which needs to know how many campaigns
  // there are. Named here so the table and the actions stay in step.
  'campaign:byNumber': null,

  'drawer:reference': () => drawer.toggle('reference'),
  'drawer:dice': () => drawer.toggle('dice'),
  'drawer:recall': () => {
    const { combat } = store.get();
    const current = combat?.combatants[combat.turnIndex];
    // On the Initiative tab, K asks about whoever's turn it is -- which is the
    // creature a player has just asked about.
    if (current && !current.characterId) {
      drawer.recall(current.id, `Asked about ${current.displayName}.`);
    } else {
      drawer.toggle('recall');
    }
  },
  'drawer:close': () => drawer.close(),

  'combat:next': () => actions.advance(1),
  'combat:previous': () => actions.advance(-1),
};

function setUpKeyboard() {
  addEventListener('keydown', (event) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    // Escape belongs to whatever is open, before anything else looks at it.
    if (event.key === 'Escape' && !$('#switcher').hidden) { closeSwitcher(); return; }

    const shortcut = shortcutFor(event, store.get().tab);
    if (shortcut) {
      // `drawer:close` is Escape, which must fall through to the browser when
      // the drawer is not open rather than being swallowed.
      if (shortcut.id === 'drawer:close' && !drawer.isOpen()) return;
      const run = SHORTCUT_ACTIONS[shortcut.id];
      if (run) { event.preventDefault(); run(); return; }
    }

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
  // A reload straight onto #/campaign/3/loop restores the tab without going
  // through selectTab, so the console has to be loaded here too.
  if (store.get().tab === 'loop' && !store.get().loopState) await actions.loadLoop(NINE_MINUTES);
  render();
}

start().catch((error) => {
  $('#loading')?.remove();
  notices.error(`Could not start: ${error.message}`);
});
