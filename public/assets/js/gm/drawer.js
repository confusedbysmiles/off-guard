/**
 * The drawer.
 *
 * One panel on the right holding the three things a GM reaches for without
 * leaving whatever they were doing: the reference, the dice, and Recall
 * Knowledge. It sits outside `#main` in the DOM, so a dashboard re-render --
 * a damage roll, an SSE update, a tab change -- does not close a table the GM
 * is reading from.
 *
 * Deliberately not a `<dialog>`. A modal would trap focus and grey out the
 * initiative tracker, and the whole point is to read the condition text *while*
 * applying it to the goblin on the row behind.
 */
import { $, el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { indexReference, referenceTab } from './views/reference.js';
import { diceTab } from './views/dice.js';
import { recallTab } from './views/recall.js';

const TABS = [
  ['reference', 'Reference', 'R'],
  ['dice', 'Dice', 'D'],
  ['recall', 'Recall Knowledge', 'K'],
];

export function createDrawer({ store, actions, notices }) {
  const root = $('#drawer');
  const body = $('#drawer-body');
  const tabList = $('#drawer-tabs');

  /** The drawer's own interface state. Not worth putting in the shared store. */
  const ui = {
    reference: { query: '', entryId: null, openGroups: [], dc: { level: 1, rarity: 'common', difficulty: null } },
    dice: { expression: '', label: '', secret: false },
  };

  let index = null;
  /** Where focus was before the drawer opened, so Escape can put it back. */
  let returnFocus = null;

  function isOpen() { return !root.hidden; }

  function open(tab) {
    const state = store.get();
    if (tab) store.set({ drawer: { ...state.drawer, tab, open: true } });
    else store.set({ drawer: { ...state.drawer, open: true } });
    if (!isOpen()) returnFocus = document.activeElement;
    root.hidden = false;
    // The dashboard makes room rather than sitting under the drawer: the point
    // of a non-modal panel is to read the condition text while applying it to
    // the goblin on the row behind, and that only works if the row is clickable.
    document.body.classList.add('with-drawer');
    render();
    focusFirst();
  }

  function close() {
    if (!isOpen()) return;
    root.hidden = true;
    document.body.classList.remove('with-drawer');
    store.set({ drawer: { ...store.get().drawer, open: false } });
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  function toggle(tab) {
    const { drawer } = store.get();
    if (isOpen() && drawer.tab === tab) close();
    else open(tab);
  }

  /** The search field on Reference, the expression on Dice; otherwise the panel. */
  function focusFirst() {
    const target = body.querySelector('input, select, button, [tabindex]');
    target?.focus();
  }

  function patchReference(patch) {
    Object.assign(ui.reference, patch);
    render();
    // Re-rendering replaces the search field, so put the caret back where it
    // was. Anything cleverer means not re-rendering, and that is a bigger cost.
    if ('query' in patch) {
      const field = $('#ref-search');
      if (field) { field.focus(); field.setSelectionRange(field.value.length, field.value.length); }
    }
  }

  function patchDice(patch) {
    Object.assign(ui.dice, patch);
    render();
    if ('expression' in patch) {
      const field = $('#dice-expression');
      if (field) { field.focus(); field.setSelectionRange(field.value.length, field.value.length); }
    }
  }

  /**
   * An internal reference link, from resolved Foundry markup.
   *
   * `#/ref/condition/frightened` and `#/ref/action/demoralize` open in the
   * drawer; `#/ref/creature/...` opens the stat block, because that is a
   * different kind of thing and belongs in the dialog that already renders one.
   * Anything else says plainly that it is not in the bundled reference rather
   * than doing nothing.
   */
  function followRef(href) {
    const match = /^#\/ref\/([^/]+)\/(.+)$/.exec(href);
    if (!match) return false;
    const [, kind, id] = match;

    if (kind === 'creature' || kind === 'hazard') {
      actions.preview(id);
      return true;
    }

    const entryId = `${kind}/${id}`;
    if (!index) {
      // The corpus has not been fetched yet -- the GM followed a link out of a
      // stat block without having opened the drawer. Fetch it, then try again.
      ensureReference().then(() => followRef(href));
      return true;
    }
    if (index.byId.has(entryId)) {
      // A stat block is shown in a modal dialog, which would sit on top of the
      // drawer the link is about to open. Following the link means leaving the
      // stat block, so close it.
      document.querySelector('dialog[open]')?.close();
      store.set({ drawer: { ...store.get().drawer, tab: 'reference' } });
      patchReference({ entryId, query: '' });
      open('reference');
      return true;
    }

    notices.info(`“${decodeURIComponent(id)}” is not in the bundled reference.`);
    return true;
  }

  function renderTabs() {
    const { drawer } = store.get();
    tabList.replaceChildren(...TABS.map(([id, label, key]) => el('button', {
      class: 'tab', type: 'button', role: 'tab',
      'aria-selected': String(id === drawer.tab),
      onclick: () => open(id),
    }, label, el('span', { class: 'tab__key' }, key))));
  }

  function render() {
    if (!isOpen()) return;
    const state = store.get();
    renderTabs();

    if (state.drawer.tab === 'dice') {
      body.replaceChildren(diceTab({
        rolls: state.rolls,
        ui: ui.dice,
        onChange: patchDice,
        onRoll: (roll) => actions.roll(roll).then(() => {
          // The expression stays: a GM rolls the same damage three times in a
          // row. The label stays too, for the same reason.
          render();
        }),
        onDerive: (id, derivation) => actions.deriveRoll(id, derivation).then(render),
        onClear: () => actions.clearRolls().then(render),
      }));
      return;
    }

    if (state.drawer.tab === 'recall') {
      body.replaceChildren(recallTab({
        recall: state.recall,
        subject: state.recall?.subject ?? null,
        onReveal: (fact, revealed) => actions.revealFact(fact, revealed).then(render),
        onRevealAll: (revealed) => actions.revealAllFacts(revealed).then(render),
        onDifficulty: (difficulty) => actions.reloadRecall(difficulty).then(render),
      }));
      return;
    }

    body.replaceChildren(referenceTab({
      index,
      ui: ui.reference,
      onChange: patchReference,
    }));
  }

  /** Load the corpus once, the first time the drawer is opened. */
  async function ensureReference() {
    if (index) return;
    try {
      index = indexReference(await actions.loadReference());
    } catch (error) {
      notices.error(`Could not load the reference: ${error.message}`);
      index = indexReference({ available: false, entries: [], groups: [] });
    }
    render();
  }

  // On the document rather than the drawer: resolved Foundry links appear in
  // stat blocks too, and following one there used to write `#/ref/...` into the
  // fragment the dashboard uses for its own routing.
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a.og-ref');
    if (!link) return;
    event.preventDefault();
    followRef(link.getAttribute('href') ?? '');
  });

  $('#drawer-close').addEventListener('click', close);

  return {
    open: (tab) => { open(tab); ensureReference(); },
    toggle: (tab) => { toggle(tab); if (isOpen()) ensureReference(); },
    close,
    isOpen,
    render,
    followRef,
    /** Open on Recall Knowledge for a combatant, from the tracker. */
    async recall(combatantId, subject) {
      await actions.openRecall(combatantId, subject);
      open('recall');
    },
  };
}

/** The drawer's chrome, appended to the page once at startup. */
export function drawerShell() {
  return el('aside', {
    class: 'drawer', id: 'drawer', hidden: true,
    'aria-label': 'Reference, dice and Recall Knowledge',
  },
  el('div', { class: 'drawer__head' },
    el('div', { class: 'tabs', id: 'drawer-tabs', role: 'tablist' }),
    el('button', {
      class: 'btn btn--icon btn--quiet', id: 'drawer-close', type: 'button',
      html: `${icon('x')}<span class="sr-only">Close the drawer</span>`,
    })),
  el('div', { class: 'drawer__body', id: 'drawer-body' }));
}
