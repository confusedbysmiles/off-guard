/**
 * The loop console.
 *
 * For adventures where the evening resets and the party keeps its memories.
 * It deliberately holds no combatants, no hit points and no turn order: the
 * initiative tracker owns a fight, and this owns the thing a fight has no
 * concept of, which is what a reset keeps.
 *
 * DOM only, like every view here. The transitions are in `src/shared/loop.js`
 * and the persistence is in `actions.js`.
 *
 * The clock is nine slots rather than ninety rounds because at these levels
 * distance is not the constraint -- a PC covers two thousand feet inside the
 * window -- and attention is. Three PCs across nine slots is twenty-seven
 * actions against four times that much to do, which is the actual puzzle.
 */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { clockFace, eventAt, isPerfectRun } from '../../../../engine/shared/loop.js';

const label = (text) => el('span', { class: 'loop__label' }, text);

// --- the clock --------------------------------------------------------------

function clock(adventure, state, actions, run) {
  const { slots } = adventure.loop;
  // Shared with the shared screen, and derived from the adventure's own
  // startLabel: this used to assume the hour and the minute it started at.
  const face = clockFace(adventure, state.slot);
  const faceText = face ? `${face.text} ${face.suffix}` : `slot ${state.slot}`;
  const event = eventAt(adventure, state.slot);

  return el('section', { class: 'panel loop__clock' },
    el('div', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'The clock'),
      el('span', { class: 'loop__time' }, `${faceText} · slot ${state.slot} of ${slots}`),
      el('div', { class: 'loop__controls' },
        el('button', {
          class: 'btn', type: 'button',
          html: `${icon('chevron')}<span>Back</span>`,
          disabled: state.slot <= 1,
          onclick: () => actions.loopSlot(state.slot - 1),
        }),
        el('button', {
          class: 'btn', type: 'button',
          html: `<span>Advance</span>${icon('chevron')}`,
          disabled: state.slot >= slots,
          onclick: () => actions.loopSlot(state.slot + 1),
        }),
        el('button', {
          class: 'btn btn--danger', type: 'button',
          html: `${icon('flame')}<span>Burn the room</span>`,
          onclick: () => actions.loopReset(),
        }),
        // Its sibling, and quiet rather than danger-red: burning the room is
        // the move you make several times an evening, and this is the one you
        // make once, before the table arrives.
        el('button', {
          class: 'btn btn--quiet', type: 'button',
          title: 'Throw the run away and go back to loop 1',
          html: `${icon('undo')}<span>Start over</span>`,
          disabled: !run,
          onclick: () => actions.loopDiscard(),
        }))),
    el('ol', { class: 'loop__slots' }, ...Array.from({ length: slots }, (_, i) => {
      const n = i + 1;
      const marked = eventAt(adventure, n);
      return el('li', {},
        el('button', {
          class: `loop__slot${n < state.slot ? ' is-past' : ''}${n === state.slot ? ' is-now' : ''}${marked ? ` is-${marked.tone}` : ''}`,
          type: 'button',
          'aria-current': n === state.slot ? 'step' : null,
          'aria-label': `Slot ${n}${marked ? `, ${marked.label}` : ''}`,
          onclick: () => actions.loopSlot(n),
        },
        el('span', { class: 'loop__slot-n' }, String(n)),
        marked ? el('span', { class: 'loop__slot-tag' }, marked.label) : null));
    })),
    event ? el('p', { class: `loop__event is-${event.tone}` }, event.note) : null);
}

// --- faults -----------------------------------------------------------------

function faultCard(fault, flags, actions) {
  const state = flags ?? {};
  const detail = el('div', { class: 'loop__detail', hidden: true },
    el('div', {}, label('Discovery'),
      el('ul', { class: 'loop__list' }, ...fault.discovery.map((d) => el('li', {}, d)))),
    el('div', {}, label('Routes'),
      ...fault.routes.map((route) => el('div', {
        class: `loop__route${route.bad ? ' is-bad' : ''}${route.sticky ? ' is-sticky' : ''}`,
      },
      el('span', { class: 'loop__route-label' }, route.label),
      el('span', { class: 'loop__route-dc' }, route.dc),
      route.note ? el('span', { class: 'loop__route-note' }, route.note) : null))),
    fault.routes.some((r) => r.sticky)
      ? el('div', { class: 'chips' }, el('button', {
        class: 'pill', type: 'button', 'aria-pressed': String(Boolean(state.sticky)),
        title: 'Solved by removing the cause. Survives every reset.',
        onclick: () => actions.loopSticky(fault.id, !state.sticky),
      }, 'Solved permanently'))
      : null);

  const toggle = el('button', {
    class: 'loop__fault-toggle', type: 'button', 'aria-expanded': 'false',
    onclick: (event) => {
      const open = detail.hidden;
      detail.hidden = !open;
      event.currentTarget.setAttribute('aria-expanded', String(open));
    },
  },
  el('span', { class: 'loop__fault-n' }, fault.n),
  el('span', { class: 'loop__fault-body' },
    el('span', { class: 'loop__fault-name' }, fault.name),
    el('span', { class: 'loop__fault-sum' }, fault.summary)));

  return el('article', {
    class: `loop__fault${state.fixed ? ' is-fixed' : state.known ? ' is-known' : ''}`,
  },
  el('div', { class: 'loop__fault-head' },
    toggle,
    el('div', { class: 'loop__pills' },
      el('button', {
        class: 'pill pill--warn', type: 'button', 'aria-pressed': String(Boolean(state.known)),
        title: 'The party knows. Survives a reset.',
        onclick: () => actions.loopFault(fault.id, { known: !state.known }),
      }, 'Known'),
      el('button', {
        class: 'pill pill--good', type: 'button', 'aria-pressed': String(Boolean(state.fixed)),
        title: 'Fixed in this loop. Cleared when the room burns.',
        onclick: () => actions.loopFault(fault.id, { fixed: !state.fixed }),
      }, 'Fixed'))),
  detail);
}

// --- influence --------------------------------------------------------------

function influencePanel(adventure, state, actions) {
  const spec = adventure.influence;
  const { points, highWater, discovered } = state.influence;

  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' }, el('h2', { class: 'panel__title' }, 'Influence')),
    el('p', { class: 'loop__inf-name' }, spec.target),
    el('p', { class: 'muted loop__inf-stats' }, spec.stats),
    el('div', { class: 'loop__score' },
      el('strong', { class: 'loop__points' }, String(points)),
      el('span', { class: 'muted' }, `/ ${spec.max}`),
      el('div', { class: 'loop__step' },
        el('button', {
          class: 'btn btn--icon', type: 'button',
          html: `${icon('minus')}<span class="sr-only">Lose an influence point</span>`,
          onclick: () => actions.loopInfluence(points - 1),
        }),
        el('button', {
          class: 'btn btn--icon', type: 'button',
          html: `${icon('plus')}<span class="sr-only">Gain an influence point</span>`,
          onclick: () => actions.loopInfluence(points + 1),
        })),
      highWater > 0
        ? el('span', { class: 'loop__hw' }, `best ${highWater} — restore for 1 slot`)
        : null),
    el('ol', { class: 'loop__ladder' }, ...spec.thresholds.map((t) => el('li', {
      class: `loop__rung${points >= t.at ? ' is-hit' : ''}${highWater >= t.at ? ' is-earned' : ''}`,
    },
    el('span', { class: 'loop__rung-at' }, String(t.at)),
    el('span', {}, t.label)))),
    el('p', { class: 'loop__mod is-weak' },
      el('strong', {}, spec.weakness.mod), ' ', spec.weakness.label),
    el('p', { class: 'loop__mod is-res' },
      el('strong', {}, spec.resistance.mod), ' ', spec.resistance.label),
    label('Influence skills'),
    el('div', { class: 'chips' }, ...spec.skills.map((s) => el('span', { class: 'pill' }, `${s.name} DC ${s.dc}`))),
    label('Discovered'),
    el('div', { class: 'chips' }, ...spec.discovery.map((d) => el('button', {
      class: 'pill', type: 'button', 'aria-pressed': String(discovered.includes(d.name)),
      onclick: () => actions.loopDiscovery(d.name),
    }, `${d.name} DC ${d.dc}`))),
    el('p', { class: 'loop__house' },
      el('strong', {}, 'House rule '), spec.houseRule));
}

// --- the slot log -----------------------------------------------------------

function slotLog(adventure, state, actions) {
  const { slots } = adventure.loop;
  const forLoop = state.log?.[state.loop] ?? {};

  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'Slot allocation'),
      el('span', { class: 'muted' }, `Loop ${state.loop}`)),
    el('div', { class: 'loop__log-wrap' },
      el('div', { class: 'loop__log' },
        el('span', {}, ''),
        ...Array.from({ length: slots }, (_, i) => el('span', {
          class: `loop__log-h${i + 1 === state.slot ? ' is-now' : ''}`,
        }, String(i + 1))),
        ...state.party.flatMap((name, pi) => [
          el('input', {
            class: 'loop__log-name', type: 'text', value: name,
            'aria-label': `Character ${pi + 1} name`,
            onchange: (e) => actions.loopParty(pi, e.target.value),
          }),
          ...Array.from({ length: slots }, (_, si) => {
            const slot = si + 1;
            const value = forLoop?.[pi]?.[slot] ?? '';
            const cell = el('textarea', {
              class: `loop__log-cell${slot === state.slot ? ' is-now' : ''}${value ? ' is-filled' : ''}`,
              rows: '2', 'aria-label': `${name}, slot ${slot}`,
              onchange: (e) => actions.loopNote(pi, slot, e.target.value),
            });
            cell.value = value;
            return cell;
          }),
        ]))));
}

// --- stat blocks and prompts ------------------------------------------------

function statBlocks(adventure) {
  const row = (key, value) => (value && value !== '—'
    ? el('div', { class: 'loop__sb-row' }, el('dt', {}, key), el('dd', {}, value))
    : null);

  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' }, el('h2', { class: 'panel__title' }, 'Stat blocks')),
    ...adventure.statblocks.map((s) => el('details', { class: 'loop__det' },
      el('summary', {},
        el('span', {}, s.name),
        el('span', { class: 'pill' }, `Lv ${s.level}`),
        el('span', { class: 'muted loop__det-xp' }, s.xp)),
      el('dl', { class: 'loop__sb' },
        row('Defense', s.defense),
        row('Traits', s.traits.join(', ')),
        row('Immune', s.immune),
        row('Resist', s.resist),
        row('Weak', s.weak),
        row('Speed', s.speed),
        el('div', { class: 'loop__sb-row' }, el('dt', {}, 'Attacks'),
          el('dd', {}, el('ul', { class: 'loop__list' }, ...s.attacks.map((a) => el('li', {}, a))))),
        el('div', { class: 'loop__sb-row' }, el('dt', {}, 'Abilities'),
          el('dd', {}, el('ul', { class: 'loop__list' }, ...s.abilities.map((a) => el('li', {}, a))))),
        el('p', { class: 'loop__sb-note' }, s.gmNote),
        el('p', { class: 'muted loop__src' }, s.source)))));
}

function prompts(adventure) {
  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' }, el('h2', { class: 'panel__title' }, 'GM prompts')),
    ...adventure.prompts.map((p) => {
      const body = el('p', { class: 'muted', hidden: true }, p.text);
      return el('div', { class: 'loop__prompt' },
        el('button', {
          class: 'btn btn--quiet loop__prompt-btn', type: 'button', 'aria-expanded': 'false',
          onclick: (e) => {
            const open = body.hidden;
            body.hidden = !open;
            e.currentTarget.setAttribute('aria-expanded', String(open));
          },
        }, p.label),
        body);
    }));
}

// --- Recall Knowledge -------------------------------------------------------

/**
 * Prepared answers, including the erroneous half the Dubious Knowledge feat
 * hands out on a failure.
 *
 * Labelled here because the GM needs to know which is which. The delivery rule
 * is the opposite and is printed on the panel: both halves flat, same breath,
 * no tell.
 */
function recallPanel(adventure) {
  const pairs = adventure.recallKnowledge ?? [];
  if (!pairs.length) return null;

  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'Recall Knowledge'),
      el('span', { class: 'pill pill--warn' }, 'Dubious Knowledge')),
    el('p', { class: 'muted loop__rk-rule' },
      'Fires on a failure that is not a critical failure. Read both halves flat, '
      + 'in one breath, with no tell \u2014 lean on either and the feat stops working '
      + 'for the rest of the session.'),
    ...pairs.map((pair) => el('details', { class: 'loop__det' },
      el('summary', {},
        el('span', {}, pair.topic),
        el('span', { class: 'muted loop__det-xp' }, pair.skills)),
      el('div', { class: 'loop__rk' },
        el('p', { class: 'loop__rk-line is-true' },
          el('strong', {}, 'True '), pair.truth),
        el('p', { class: 'loop__rk-line is-false' },
          el('strong', {}, 'Erroneous '), pair.lie),
        el('p', { class: 'muted loop__rk-note' }, pair.note)))));
}

// --- the beats ---------------------------------------------------------------

/**
 * The ten moments that carry the session.
 *
 * Ticking one is not bookkeeping; it is the question "has this landed yet?"
 * asked at a glance. An un-ticked beat two acts after its window is the single
 * most useful thing this console can tell a GM mid-session, which is why the
 * lever sits inside each one rather than in a separate table nobody opens.
 */
function beatsPanel(adventure, state, actions) {
  const beats = adventure.beats ?? [];
  if (!beats.length) return null;
  const done = beats.filter((b) => state.beats?.[b.id]).length;

  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'The beats'),
      el('span', { class: 'muted loop__beat-count' }, `${done} of ${beats.length}`)),
    el('ol', { class: 'loop__beats' }, ...beats.map((beat, i) => {
      const landed = Boolean(state.beats?.[beat.id]);
      const detail = el('div', { class: 'loop__beat-detail', hidden: true },
        el('p', { class: 'loop__beat-line' }, el('strong', {}, 'Landed when '), beat.landed),
        el('p', { class: 'loop__beat-line is-lever' }, el('strong', {}, 'If it has not '), beat.lever));

      const newAct = i === 0 || beats[i - 1].act !== beat.act;

      return el('li', { class: `loop__beat${landed ? ' is-landed' : ''}${newAct ? ' is-act-start' : ''}` },
        newAct ? el('span', { class: 'loop__act' }, `Act ${beat.act}`) : null,
        el('div', { class: 'loop__beat-row' },
          el('button', {
            class: 'loop__beat-tick', type: 'button',
            'aria-pressed': String(landed),
            'aria-label': `${beat.name} \u2014 mark landed`,
            onclick: () => actions.loopBeat(beat.id, !landed),
          }, landed ? el('span', { html: icon('check') }) : el('span', { class: 'loop__beat-n' }, String(beat.n))),
          el('button', {
            class: 'loop__beat-name', type: 'button', 'aria-expanded': 'false',
            onclick: (e) => {
              const open = detail.hidden;
              detail.hidden = !open;
              e.currentTarget.setAttribute('aria-expanded', String(open));
            },
          },
          el('span', {}, beat.name),
          el('span', { class: 'muted loop__beat-when' }, beat.when))),
        detail);
    })));
}

// --- the view ---------------------------------------------------------------

export function loopView({ adventure, run, state, actions }) {
  if (!adventure) {
    return el('div', { class: 'panels' }, el('section', { class: 'panel' },
      el('p', { class: 'muted' }, 'No looping adventure is loaded for this campaign.')));
  }

  return el('div', { class: 'loop' },
    el('div', { class: 'loop__head' },
      el('h2', { class: 'loop__title' }, adventure.title),
      el('p', { class: 'muted' }, adventure.subtitle ?? ''),
      el('div', { class: 'loop__count' },
        label('Loop'), el('strong', {}, String(state.loop))),
      run ? null : el('span', { class: 'pill pill--warn' }, 'Not saved yet')),
    clock(adventure, state, actions, run),
    isPerfectRun(state, adventure)
      ? el('p', { class: 'loop__perfect' },
        el('span', { html: icon('check') }),
        el('span', {},
          el('strong', {}, 'All four faults fixed in one loop. '),
          'The toast lands. Qazrahin becomes visible at 8:00 and reaches for the fire anyway.'))
      : null,
    el('div', { class: 'loop__cols' },
      el('div', { class: 'panels' },
        beatsPanel(adventure, state, actions),
        el('section', { class: 'panel' },
          el('div', { class: 'panel__head' }, el('h2', { class: 'panel__title' }, 'The faults')),
          el('div', { class: 'loop__faults' },
            ...adventure.faults.map((f) => faultCard(f, state.faults?.[f.id], actions)))),
        slotLog(adventure, state, actions)),
      el('div', { class: 'panels' },
        influencePanel(adventure, state, actions),
        recallPanel(adventure),
        statBlocks(adventure),
        prompts(adventure))));
}
