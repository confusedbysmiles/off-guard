/**
 * The character sheet page.
 *
 * Wiring only: the store owns the data, `render.js` owns the DOM, and this file
 * connects them and handles the things that belong to the page itself -- the
 * theme, the save indicator, the import dialog and the keyboard.
 */
import { displayName } from '../../../engine/shared/character-name.js';
import { $, debounce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { setUpTheme } from '../lib/theme.js';
import { apiPath, token } from '../lib/mount.js';
import { createStore, STATUS } from './store.js';
import { mount } from './render.js';
import { openImportDialog } from './import.js';

/**
 * The token is read from the path and never written anywhere else -- not into
 * the title, not into a data attribute, not into a link.
 */
const endpoint = apiPath(`/api/c/${token}`);

const store = createStore({ endpoint, storageKey: token.slice(0, 8) });

const SAVE_LABEL = {
  [STATUS.saved]: 'Saved',
  [STATUS.saving]: 'Saving…',
  [STATUS.pending]: 'Unsaved changes',
  [STATUS.offline]: 'Offline — changes are kept here',
  [STATUS.conflict]: 'Someone else changed a field',
  [STATUS.error]: 'Could not load',
};

/**
 * The builder, for this same character and the same token. A separate page
 * rather than a mode: the sheet is used one-handed at the table and the builder
 * is not, and making one of them serve both would cost the sheet.
 */
function setUpBuildLink() {
  // The destination is computed at click time and never written into the DOM:
  // an `href` would carry the token in the markup, which `page.content()` can
  // read and a screenshot or a copied element would leak.
  $('#build').addEventListener('click', () => {
    globalThis.location.assign(apiPath(`/build/${token}`));
  });
}

function setUpIcons() {
  $('#undo').prepend(fragment(icon('undo')));
  $('#print').prepend(fragment(icon('print')));
}

function fragment(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

// --- theme ---------------------------------------------------------------

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

/**
 * The campaign's accent colour.
 *
 * Written into a constructed stylesheet rather than onto `document
 * .documentElement.style`. A style attribute -- however it is set -- is an
 * inline style, and the policy has no `unsafe-inline`; a stylesheet built
 * through the CSSOM is not, so this is the one route that applies a per-campaign
 * colour without the page reporting a violation on every load.
 */
let accentSheet = null;
let accentValue = null;

function applyAccent(color) {
  if (color === accentValue) return;
  if (!/^#[0-9a-f]{3,8}$/i.test(color)) return;
  accentValue = color;
  if (!accentSheet) {
    if (typeof CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in document)) return;
    accentSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, accentSheet];
  }
  accentSheet.replaceSync(`:root { --primary: ${color}; }`);
}

// --- notices -------------------------------------------------------------

function renderNotices(state) {
  const host = $('#notices');
  const notices = [];

  for (const conflict of state.conflicts) {
    const node = document.createElement('div');
    node.className = 'notice';
    node.innerHTML = `${icon('alert')}
      <div class="notice__body">
        <strong>${escapeHtml(prettyPath(conflict.path))} was changed elsewhere.</strong>
        <p class="muted">Now: ${escapeHtml(preview(conflict.currentValue))}.
        Yours was: ${escapeHtml(preview(conflict.localValue))}.</p>
        <div class="notice__actions">
          <button class="btn" data-keep="${escapeHtml(conflict.path)}">Put mine back</button>
          <button class="btn btn--quiet" data-dismiss="${escapeHtml(conflict.path)}">Keep theirs</button>
        </div>
      </div>`;
    node.querySelector('[data-keep]').addEventListener('click', () => store.keepLocal(conflict.path));
    node.querySelector('[data-dismiss]').addEventListener('click', () => store.dismissConflict(conflict.path));
    notices.push(node);
  }

  host.replaceChildren(...notices);
}

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const prettyPath = (path) => String(path).split('.').map(
  (part) => part.replace(/([a-z])([A-Z])/g, '$1 $2'),
).join(' → ');

function preview(value) {
  if (value === null || value === undefined || value === '') return 'empty';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

// --- start ---------------------------------------------------------------

async function start() {
  setUpIcons();
  setUpThemeButton();
  setUpBuildLink();

  const root = $('#sheet');
  const update = mount(root, store, {
    onImport: () => openImportDialog({ store, endpoint }),
  });

  $('#undo').addEventListener('click', () => store.undo());
  $('#print').addEventListener('click', () => window.print());

  store.subscribe((state) => {
    const indicator = $('#save-state');
    indicator.textContent = SAVE_LABEL[state.status] ?? state.status;
    indicator.dataset.status = state.status;

    $('#undo').disabled = !state.canUndo;

    if (state.character) {
      // Until the player names it, this is "Alex's character" -- the same
      // thing the GM's roster and the links panel call it, so the person who
      // was sent the link recognises what they were sent.
      $('#character-name').textContent = displayName({
        name: state.sheet.name || state.character.name,
        playerName: state.sheet.playerName || state.character.playerName,
      });
      $('#campaign-name').textContent = state.campaign?.name ?? '';
      if (state.campaign?.accentColor) applyAccent(state.campaign.accentColor);
    }

    renderNotices(state);
    update(state);
  });

  await store.load();
  $('#loading')?.remove();

  addImportButton();

  connectStream();

  // Everything queued is sent before the tab closes, and the queue survives if
  // the send does not arrive.
  addEventListener('visibilitychange', () => { if (document.hidden) store.flush(); });
  addEventListener('online', () => store.flush());

  addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    if ((event.metaKey || event.ctrlKey) && event.key === 'z' && !typing) {
      event.preventDefault();
      store.undo();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      store.flush();
    }
  });
}

/**
 * The live stream, so a condition the GM pushes appears without a refresh.
 *
 * EventSource reconnects on its own; the only thing to handle here is a tab
 * that was asleep, which comes back with a stream the browser has not yet
 * noticed is dead.
 */
let source = null;

function connectStream() {
  if (typeof EventSource !== 'function') return;
  source?.close();
  source = new EventSource(`${endpoint}/stream`);

  const onData = (event) => {
    try {
      store.receive(JSON.parse(event.data));
    } catch (error) {
      console.error('Could not read an update', error);
    }
  };

  source.addEventListener('snapshot', onData);
  source.addEventListener('character', onData);

  addEventListener('visibilitychange', () => {
    if (!document.hidden && source?.readyState === EventSource.CLOSED) connectStream();
  }, { once: true });
}

function addImportButton() {
  const button = document.createElement('button');
  button.className = 'btn';
  button.type = 'button';
  button.innerHTML = `${icon('upload')}<span>Import from Pathbuilder</span>`;
  button.addEventListener('click', () => openImportDialog({ store, endpoint }));

  const section = document.createElement('section');
  section.className = 'card section--wide';
  section.append(button);
  $('#sheet').append(section);
}

const flushSoon = debounce(() => store.flush(), 2000);
addEventListener('beforeunload', () => flushSoon.flush());

start().catch((error) => {
  const indicator = $('#save-state');
  indicator.textContent = 'Could not start';
  indicator.dataset.status = 'error';
  console.error(error);
});
