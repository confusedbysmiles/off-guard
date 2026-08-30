/**
 * The character builder page.
 *
 * Wiring only, in the same shape as the sheet: `state.js` owns the data,
 * `timeline.js` and `summary.js` own the DOM, `picker.js` owns the dialog, and
 * this file connects them and handles what belongs to the page -- the theme,
 * the save indicator, the level controls and the link back to play.
 *
 * Building and playing are separate pages on purpose. The sheet is used
 * one-handed on a phone while holding dice; the builder is two hands and a lot
 * of reading. Trying to be both at once would compromise the sheet, which is
 * the one that gets used at the table every week.
 */
import { $, debounce, el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { setUpTheme } from '../lib/theme.js';
import { apiPath, token } from '../lib/mount.js';
import { createNotices } from '../lib/notices.js';
import { createBuildStore, STATUS } from './state.js';
import { renderTimeline } from './timeline.js';
import { renderSummary } from './summary.js';
import { renderEquipment } from './equipment.js';
import { createPicker } from './picker.js';

const endpoint = apiPath(`/api/c/${token}`);
const store = createBuildStore({ endpoint, storageKey: token.slice(0, 8) });
const notices = createNotices($('#notices'));

const SAVE_LABEL = {
  [STATUS.ready]: 'Saved',
  [STATUS.saving]: 'Saving…',
  [STATUS.pending]: 'Unsaved changes',
  [STATUS.offline]: 'Offline — your choices are kept here',
  [STATUS.error]: 'Could not load',
};

const picker = createPicker({
  dialog: $('#picker-dialog'),
  endpoint,
  onChoose: (slot, id) => applyChoice(slot, id),
});

/**
 * A choice from the picker.
 *
 * The identity slots are named fields on the build; everything else is a feat
 * slot keyed by the slot's own id, which is what makes planning work -- a level
 * 12 class feat and a level 2 one are two keys, not two states of one.
 */
function applyChoice(slot, id) {
  store.update((build) => {
    // Equipment keeps its runes and its name when the base item changes: a
    // player swapping a longsword for a greatsword has not thrown away the
    // striking rune they paid for.
    if (slot.kind === 'armor') {
      build.equipment ??= {};
      build.equipment.armor = id ? { ...(build.equipment.armor ?? {}), id } : null;
      return;
    }
    if (slot.kind === 'weapon') {
      build.equipment ??= {};
      const weapons = [...(build.equipment.weapons ?? [])];
      weapons[slot.index] = { ...(weapons[slot.index] ?? {}), id };
      build.equipment.weapons = weapons;
      return;
    }
    if (['ancestry', 'heritage', 'background', 'class'].includes(slot.kind)) {
      build[slot.kind] = id;
      // A new ancestry invalidates a heritage that belonged to the old one, and
      // leaving it would silently keep a dwarf heritage on an elf.
      if (slot.kind === 'ancestry') {
        build.heritage = null;
        build.attributes = { ...(build.attributes ?? {}), ancestry: [] };
      }
      if (slot.kind === 'background') {
        build.attributes = { ...(build.attributes ?? {}), background: [] };
      }
      return;
    }
    build.feats ??= {};
    if (id) build.feats[slot.id] = id;
    else delete build.feats[slot.id];
  });
}

// --- the page's own controls ---------------------------------------------

function setUpLevelControls(state) {
  const level = $('#level');
  const planTo = $('#plan-to');
  const current = state.derived?.level ?? state.build?.level ?? 1;
  const horizon = state.derived?.planTo ?? current;

  if (document.activeElement !== level) level.value = String(current);
  if (document.activeElement !== planTo) planTo.value = String(horizon);
  planTo.min = String(current);
}

function setUpThemeButton() {
  setUpTheme($('#theme'), (isLight) => {
    $('#theme').replaceChildren(
      fragment(icon(isLight ? 'moon' : 'sun')),
      Object.assign(document.createElement('span'), {
        className: 'sr-only',
        textContent: isLight ? 'Switch to the dark theme' : 'Switch to the light theme',
      }),
    );
  });
}

function fragment(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

// --- render ---------------------------------------------------------------

let lastError = null;

store.subscribe((state) => {
  $('#save-state').textContent = SAVE_LABEL[state.status] ?? '';
  $('#save-state').dataset.status = state.status;

  if (state.status === STATUS.error && state.lastError !== lastError) {
    lastError = state.lastError;
    notices.error('Could not load your character.', { detail: state.lastError });
  }

  if (!state.derived) return;

  $('#loading')?.remove();
  $('#outstanding').textContent = state.derived.outstanding
    ? `${state.derived.outstanding} still to choose`
    : 'Everything chosen';
  $('#outstanding').dataset.done = String(state.derived.outstanding === 0);

  setUpLevelControls(state);
  renderTimeline($('#timeline'), { state, store, picker });
  renderEquipment($('#equipment'), { state, store, picker });
  renderSummary($('#summary'), { state });
});

$('#level').addEventListener('change', (event) => {
  const value = Math.max(1, Math.min(20, Number(event.currentTarget.value) || 1));
  store.update((build) => { build.level = value; });
});

$('#plan-to').addEventListener('change', (event) => {
  const value = Math.max(1, Math.min(20, Number(event.currentTarget.value) || 1));
  store.update((build) => { build.planTo = value; });
});

// The one control that wants waiting for: a name is typed, not chosen.
$('#name').addEventListener('input', debounce((event) => {
  const value = event.currentTarget.value;
  store.update((build) => { build.name = value; }, { immediate: false });
}, 400));

// Computed on click, never written into the DOM: see the note in sheet/main.js.
$('#play').addEventListener('click', () => {
  globalThis.location.assign(apiPath(`/c/${token}`));
});

// A save in flight when the tab closes is a save that never happened.
globalThis.addEventListener('pagehide', () => { store.flush(); });

setUpThemeButton();
store.load().then(() => {
  const name = store.state.build?.name ?? '';
  if ($('#name').value !== name) $('#name').value = name;
});
