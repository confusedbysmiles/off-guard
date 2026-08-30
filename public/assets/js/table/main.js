/**
 * The shared initiative screen.
 *
 * Read-only. There is nothing on this page that can write, and the token it
 * runs under cannot write either -- the server refuses a table scope on every
 * mutating call, so this is belt and braces rather than the only guard.
 *
 * The connection state is always visible. A screen cast to a television that
 * has quietly stopped updating is worse than one that says it has stopped,
 * because the table keeps believing it.
 */
import { $, el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { prefersLight } from '../lib/theme.js';
import { apiPath, token } from '../lib/mount.js';

const endpoint = apiPath(`/api/table/${token}`);

const DENSITY_KEY = 'off-guard:table-density';

let lastActiveId = null;
let source = null;
let lostTimer = null;

// --- connection state -------------------------------------------------------

const STATES = {
  live: 'Live',
  connecting: 'Connecting…',
  lost: 'Connection lost — retrying',
};

function setConnection(state) {
  const node = $('#connection');
  node.dataset.state = state;
  $('#connection-text').textContent = STATES[state] ?? state;
}

// --- rendering ---------------------------------------------------------------

function render(view) {
  $('#round').textContent = view.round ? `Round ${view.round}` : 'Not in combat';
  renderRolls(view.rolls ?? []);
  renderLoop(view.loop ?? null, !view.combatants?.length);

  const order = $('#order');
  if (!view.combatants?.length) {
    // With a loop running this screen still has a job between fights -- the
    // clock, and what the party has worked out -- so "No fight running" stops
    // being the headline and the loop takes the width. Without one, nothing
    // has changed: the empty state is still the whole message.
    order.replaceChildren(el('p', { class: 'table-empty' },
      view.round ? 'Nothing to show yet.' : 'No fight running.'));
    return;
  }

  order.replaceChildren(...view.combatants.map((combatant) => turnRow(combatant, view.activeId)));
  announceTurn(view);
}

// --- the loop ----------------------------------------------------------------

let lastSlot = null;

/**
 * The clock, and what the party knows.
 *
 * The clock is the largest thing on the page on purpose: in a looping adventure
 * it is the fact everything else hangs off, and a table that has to hunt for
 * the minute is a table that stops believing the minute.
 *
 * Everything here arrives resolved. The page is not given the adventure, so it
 * cannot show a fault nobody has found, and there is nothing in its source for
 * a curious player to read.
 */
function renderLoop(loop, idle) {
  const clock = $('#clock');
  const panel = $('#loop-room');
  const columns = $('#columns');
  columns.classList.toggle('has-loop', Boolean(loop));
  // Between fights the loop is the only thing on this screen, so it stops
  // being a column beside the order and becomes the screen.
  columns.classList.toggle('is-idle', idle);

  if (!loop) {
    clock.hidden = true;
    panel.hidden = true;
    lastSlot = null;
    return;
  }

  clock.hidden = false;
  $('#clock-time').textContent = loop.clock
    ? `${loop.clock.text}`
    : `Minute ${loop.slot}`;
  $('#clock-meta').textContent = [
    loop.clock?.suffix,
    `Loop ${loop.loop}`,
    loop.slots ? `minute ${loop.slot} of ${loop.slots}` : null,
  ].filter(Boolean).join(' · ');

  const event = $('#clock-event');
  event.hidden = !loop.event;
  if (loop.event) {
    event.textContent = loop.event.label;
    event.dataset.tone = loop.event.tone ?? '';
  }

  // A minute that has just moved is worth a beat of attention, and nothing
  // else on this page animates. Skipped on the first render so casting the
  // screen mid-session does not flash.
  if (lastSlot !== null && loop.slot !== lastSlot) {
    clock.classList.remove('is-ticking');
    // Reading offsetWidth restarts the animation; without it a second tick in
    // the same paint does nothing.
    void clock.offsetWidth;
    clock.classList.add('is-ticking');
  }
  lastSlot = loop.slot;

  panel.hidden = false;
  panel.replaceChildren(
    el('h2', { class: 'loop-room__title' }, loop.title),
    loop.known.length
      ? el('ul', { class: 'loop-room__list' }, ...loop.known.map((fault) => el('li', {
        class: `loop-room__fault${fault.fixed ? ' is-fixed' : ''}`,
      },
      fault.n ? el('span', { class: 'loop-room__n' }, fault.n) : null,
      el('span', { class: 'loop-room__name' }, fault.name),
      el('span', { class: 'loop-room__state' }, fault.fixed ? 'fixed' : 'known'))))
      : el('p', { class: 'loop-room__empty' }, 'Nothing worked out yet.'),
    loop.influence.max
      ? el('p', { class: 'loop-room__influence' },
        el('span', {}, 'Influence '),
        el('strong', {}, `${loop.influence.points}`),
        el('span', { class: 'loop-room__of' }, ` / ${loop.influence.max}`))
      : null,
  );
}

/** The last few open rolls, newest first. */
function renderRolls(rolls) {
  const strip = $('#rolls');
  strip.hidden = rolls.length === 0;
  strip.replaceChildren(...rolls.map((roll) => el('div', { class: 'table-roll' },
    el('span', { class: 'table-roll__total' }, String(roll.total)),
    el('span', { class: 'table-roll__label' },
      roll.label || roll.expression,
      roll.derivation
        ? el('span', { class: 'table-roll__note' },
          roll.derivation === 'half' ? ' halved' : ' doubled')
        : null))));
}

function turnRow(combatant, activeId) {
  const current = combatant.id === activeId;

  return el('article', {
    class: `turn${current ? ' turn--current' : ''}`
      + (combatant.state && combatant.state !== 'normal' ? ' turn--waiting' : ''),
    'aria-current': current ? 'true' : null,
  },
  el('div', {},
    el('div', { class: 'turn__name' },
      current ? el('span', { class: 'turn__caret', 'aria-hidden': 'true' }, '▶ ') : null,
      combatant.name),
    combatant.playerName ? el('div', { class: 'turn__player' }, combatant.playerName) : null,
    stateChips(combatant)),
  health(combatant));
}

function stateChips(combatant) {
  const chips = [];

  if (combatant.state && combatant.state !== 'normal') {
    chips.push(el('span', { class: 'turn__condition' }, titleCase(combatant.state)));
  }
  for (const condition of combatant.conditions ?? []) {
    chips.push(el('span', { class: 'turn__condition' },
      `${titleCase(condition.slug)}${condition.value ? ` ${condition.value}` : ''}`));
  }
  // Recall Knowledge facts the GM has chosen to reveal.
  for (const fact of combatant.revealed ?? []) {
    chips.push(el('span', { class: 'turn__fact' },
      typeof fact === 'string' ? fact : `${fact.label}: ${fact.value}`));
  }

  return chips.length ? el('div', { class: 'turn__state' }, ...chips) : null;
}

function health(combatant) {
  // A creature shows a descriptor unless the GM flipped it to numeric; a player
  // character always shows numbers, because the party knows its own.
  if (combatant.health) {
    return el('div', { class: 'turn__health' },
      el('div', { class: 'turn__descriptor', dataset: { health: combatant.health } },
        combatant.health));
  }

  if (!Number.isFinite(combatant.hpMax) || combatant.hpMax <= 0) {
    return el('div', { class: 'turn__health' });
  }

  const fraction = Math.max(0, Math.min(1, (combatant.hpCurrent ?? 0) / combatant.hpMax));
  return el('div', { class: 'turn__health' },
    el('div', { class: 'turn__numbers' },
      `${combatant.hpCurrent}/${combatant.hpMax}`
      + (combatant.hpTemp ? ` +${combatant.hpTemp}` : '')),
    el('progress', {
      class: 'turn__bar', value: String(fraction), max: '1',
      'aria-label': `${combatant.name} hit points`,
      'aria-valuetext': `${combatant.hpCurrent} of ${combatant.hpMax}`,
      dataset: { hurt: fraction > 0.5 ? 'none' : (fraction > 0.25 ? 'some' : 'badly') },
    }));
}

/**
 * Announce a turn change, and only a turn change.
 *
 * The list is not itself a live region: a creature four rows down losing hit
 * points should not interrupt someone using a screen reader mid-sentence.
 */
function announceTurn(view) {
  if (view.activeId === lastActiveId) return;
  lastActiveId = view.activeId;
  const active = view.combatants.find((c) => c.id === view.activeId);
  if (!active) return;
  $('#announcement').textContent = `Round ${view.round}. ${active.name}'s turn.`;
}

const titleCase = (s) => String(s ?? '')
  .replace(/[-_]+/g, ' ')
  .replace(/\b[a-z]/g, (c) => c.toUpperCase());

// --- density -----------------------------------------------------------------

function setDensity(density) {
  document.body.dataset.density = density;
  const button = $('#density');
  const isTv = density === 'tv';
  button.setAttribute('aria-pressed', String(isTv));
  button.replaceChildren(
    fragment(icon(isTv ? 'phone' : 'screen')),
    Object.assign(document.createElement('span'), {
      className: 'sr-only',
      textContent: isTv ? 'Switch to phone size' : 'Switch to television size',
    }),
  );
  try { localStorage.setItem(DENSITY_KEY, density); } catch { /* private mode */ }
}

function fragment(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

function setUpDensity() {
  let stored = null;
  try { stored = localStorage.getItem(DENSITY_KEY); } catch { /* private mode */ }
  // A narrow screen is a phone whatever the stored preference says; a wide one
  // is probably the television this link was made for.
  setDensity(stored ?? (matchMedia('(max-width: 48rem)').matches ? 'phone' : 'tv'));
  $('#density').addEventListener('click', () => {
    setDensity(document.body.dataset.density === 'tv' ? 'phone' : 'tv');
  });
}

// --- the stream ---------------------------------------------------------------

function connect() {
  source?.close();
  setConnection('connecting');

  source = new EventSource(`${endpoint}/stream`);

  const onData = (event) => {
    clearTimeout(lostTimer);
    setConnection('live');
    try {
      render(JSON.parse(event.data));
    } catch (error) {
      console.error('Could not read an update', error);
    }
  };

  source.addEventListener('snapshot', onData);
  source.addEventListener('table', onData);

  source.onopen = () => { clearTimeout(lostTimer); setConnection('live'); };

  source.onerror = () => {
    // EventSource reconnects on its own, so this is about telling the room
    // rather than about retrying. The delay stops a blink during a reconnect
    // from flashing "connection lost" at the table.
    clearTimeout(lostTimer);
    lostTimer = setTimeout(() => setConnection('lost'), 2000);
  };
}

// A television goes to sleep and a phone locks; both come back with a dead
// stream that EventSource has not noticed yet.
addEventListener('visibilitychange', () => {
  if (!document.hidden && source?.readyState === EventSource.CLOSED) connect();
});
addEventListener('online', () => connect());

/**
 * This page has no theme toggle -- it has no controls at all beyond the density
 * switch -- but it is the same person on the same origin, so it follows the
 * choice they made on their sheet or the dashboard, and the system preference
 * otherwise.
 */
function applyStoredTheme() {
  document.documentElement.dataset.theme = prefersLight() ? 'light' : 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = prefersLight() ? '#F6F4FB' : '#1A1033';
}

async function start() {
  applyStoredTheme();
  setUpDensity();

  // One plain fetch first, so the screen is never blank while the stream opens
  // and so a browser with no EventSource still shows something.
  try {
    const res = await fetch(endpoint, { headers: { accept: 'application/json' } });
    if (res.ok) render(await res.json());
  } catch { /* the stream will fill it in */ }

  $('#empty')?.remove();

  if (typeof EventSource === 'function') connect();
  else setConnection('lost');
}

start();
