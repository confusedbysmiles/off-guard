/**
 * The character sheet page.
 *
 * Wiring only: the store owns the data, `render.js` owns the DOM, and this file
 * connects them and handles the things that belong to the page itself -- the
 * theme, the save indicator, the import dialog and the keyboard.
 */
import { $, debounce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { createStore, STATUS } from './store.js';
import { mount } from './render.js';
import { openImportDialog } from './import.js';

/**
 * The token is read from the path and never written anywhere else -- not into
 * the title, not into a data attribute, not into a link.
 */
const token = location.pathname.split('/')[2] ?? '';
const endpoint = `/api/c/${token}`;

const store = createStore({ endpoint, storageKey: token.slice(0, 8) });

const SAVE_LABEL = {
  [STATUS.saved]: 'Saved',
  [STATUS.saving]: 'Saving…',
  [STATUS.pending]: 'Unsaved changes',
  [STATUS.offline]: 'Offline — changes are kept here',
  [STATUS.conflict]: 'Someone else changed a field',
  [STATUS.error]: 'Could not load',
};

function setUpIcons() {
  $('#undo').prepend(fragment(icon('undo')));
  $('#print').prepend(fragment(icon('print')));
  $('#theme').prepend(fragment(icon('sun')));
}

function fragment(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

// --- theme ---------------------------------------------------------------

const THEME_KEY = 'off-guard:theme';

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;

  const button = $('#theme');
  const isLight = theme === 'light'
    || (!theme && matchMedia('(prefers-color-scheme: light)').matches);
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
    const isLight = $('#theme').getAttribute('aria-pressed') === 'true';
    const next = isLight ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
    applyTheme(next);
  });

  // A player who has never touched the toggle follows the system.
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    let current = null;
    try { current = localStorage.getItem(THEME_KEY); } catch { /* private mode */ }
    if (!current) applyTheme(null);
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
  setUpTheme();

  const root = $('#sheet');
  const update = mount(root, store);

  $('#undo').addEventListener('click', () => store.undo());
  $('#print').addEventListener('click', () => window.print());

  store.subscribe((state) => {
    const indicator = $('#save-state');
    indicator.textContent = SAVE_LABEL[state.status] ?? state.status;
    indicator.dataset.status = state.status;

    $('#undo').disabled = !state.canUndo;

    if (state.character) {
      $('#character-name').textContent = state.sheet.name || state.character.name || 'Unnamed character';
      $('#campaign-name').textContent = state.campaign?.name ?? '';
      if (state.campaign?.accentColor) applyAccent(state.campaign.accentColor);
    }

    renderNotices(state);
    update(state);
  });

  await store.load();
  $('#loading')?.remove();

  addImportButton();

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
