/**
 * Off-Guard — Loop Console
 * A GM module for looping adventures. Supplements the initiative tracker;
 * it deliberately does not duplicate it.
 *
 *   import { ADVENTURE } from './nine-minutes.data.js';
 *   import { LoopConsole, localAdapter } from './loop-console.js';
 *   const el = document.createElement('loop-console');
 *   el.adventure = ADVENTURE;
 *   el.storage = localAdapter('off-guard:loop:nine-minutes');
 *   document.body.append(el);
 *
 * No dependencies. No build step. No network calls. Light DOM, so the module
 * inherits the host application's theme tokens.
 *
 * Events (all bubble, composed):
 *   loop-console:change   detail: { state }        any state mutation
 *   loop-console:reset    detail: { from, to }     a loop was burned
 *   loop-console:perfect  detail: { loop }         all faults fixed at once
 */

/* --------------------------------------------------------------------------
 * Storage adapters. Swap this for a fetch/SSE adapter against the Off-Guard
 * API and nothing else in the component changes.
 * ----------------------------------------------------------------------- */

export function localAdapter(key) {
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },
    save(state) {
      try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* private mode */ }
    }
  };
}

export function memoryAdapter() {
  let held = null;
  return { load: () => held, save: (s) => { held = s; } };
}

/* -------------------------------------------------------------------------- */

const ICON = {
  next: 'M9 6l6 6-6 6',
  prev: 'M15 6l-6 6 6 6',
  fire: 'M12 3c0 4-4 5-4 9a4 4 0 008 0c0-2-1-3-1-3s3 1 3 5a8 8 0 01-16 0C2 8 12 8 12 3z',
  undo: 'M9 14L4 9l5-5M4 9h9a7 7 0 010 14H8',
  check: 'M20 6L9 17l-5-5'
};

function svg(path, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  s.append(p);
  return s;
}

function el(tag, opts = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(opts)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid);
  return n;
}

/* -------------------------------------------------------------------------- */

export class LoopConsole extends HTMLElement {
  #adv = null;
  #store = memoryAdapter();
  #state = null;
  #undo = null;
  #refs = {};
  #built = false;

  set adventure(a) { this.#adv = a; this.#boot(); }
  get adventure() { return this.#adv; }

  set storage(s) { this.#store = s; this.#boot(); }
  get storage() { return this.#store; }

  get state() { return structuredClone(this.#state); }

  connectedCallback() {
    if (!this.hasAttribute('tabindex')) this.tabIndex = -1;
    this.addEventListener('keydown', this.#onKey);
    this.#boot();
  }

  disconnectedCallback() { this.removeEventListener('keydown', this.#onKey); }

  /* --- state ------------------------------------------------------------ */

  #blank() {
    const known = {}, fixed = {}, sticky = {};
    for (const f of this.#adv.faults) { known[f.id] = false; fixed[f.id] = false; sticky[f.id] = false; }
    return {
      loop: 1,
      slot: 1,
      party: [...(this.#adv.party || ['PC 1', 'PC 2', 'PC 3'])],
      known, fixed, sticky,
      influence: { points: 0, highWater: 0, discovered: [] },
      log: {}
    };
  }

  #boot() {
    if (!this.#adv || !this.isConnected) return;
    if (!this.#state) this.#state = this.#store.load() || this.#blank();
    if (!this.#built) { this.#build(); this.#built = true; }
    this.#syncAll();
  }

  #commit(fn, { undoable = false } = {}) {
    if (undoable) this.#undo = structuredClone(this.#state);
    fn(this.#state);
    this.#store.save(this.#state);
    this.#syncAll();
    this.dispatchEvent(new CustomEvent('loop-console:change', {
      detail: { state: this.state }, bubbles: true, composed: true
    }));
  }

  #announce(msg) { if (this.#refs.live) this.#refs.live.textContent = msg; }

  /* --- actions ---------------------------------------------------------- */

  #slotTo(n) {
    const max = this.#adv.loop.slots;
    const next = Math.min(max, Math.max(1, n));
    if (next === this.#state.slot) return;
    this.#commit(s => { s.slot = next; });
    const ev = this.#adv.loop.events.find(e => e.slot === next);
    this.#announce(`Slot ${next} of ${max}.${ev ? ' ' + ev.label + '.' : ''}`);
  }

  #resetLoop() {
    const from = this.#state.loop;
    this.#commit(s => {
      s.loop += 1;
      s.slot = 1;
      for (const f of this.#adv.faults) s.fixed[f.id] = !!s.sticky[f.id];
      s.influence.points = 0;
    }, { undoable: true });
    this.#announce(`Loop ${from} burned. Loop ${this.#state.loop}, slot 1.`);
    this.dispatchEvent(new CustomEvent('loop-console:reset', {
      detail: { from, to: this.#state.loop }, bubbles: true, composed: true
    }));
  }

  #undoLast() {
    if (!this.#undo) return;
    this.#state = this.#undo;
    this.#undo = null;
    this.#store.save(this.#state);
    this.#syncAll();
    this.#announce('Undone.');
  }

  #onKey = (e) => {
    const t = e.target;
    if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement) return;
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); this.#slotTo(this.#state.slot + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); this.#slotTo(this.#state.slot - 1); }
    else if (k === 'r') { e.preventDefault(); this.#resetLoop(); }
    else if (k === 'u') { e.preventDefault(); this.#undoLast(); }
  };

  /* --- build ------------------------------------------------------------ */

  #build() {
    const a = this.#adv;
    const R = this.#refs;
    this.textContent = '';

    R.live = el('div', { class: 'ogl-live', role: 'status', 'aria-live': 'polite' });

    /* header */
    R.loopN = el('b', { class: 'ogl-num', text: '1' });
    const head = el('div', { class: 'ogl-head' },
      el('div', {},
        el('h1', { class: 'ogl-title', text: a.title }),
        el('div', { class: 'ogl-sub', text: a.subtitle || '' })
      ),
      el('div', { class: 'ogl-head-spacer' }),
      el('div', { class: 'ogl-loopcount' },
        el('span', { class: 'ogl-label', text: 'Loop' }), R.loopN)
    );

    /* clock */
    R.time = el('div', { class: 'ogl-clock-time' });
    R.slots = el('div', { class: 'ogl-slots', role: 'group', 'aria-label': 'Loop slots' });
    R.slotEls = [];
    for (let i = 1; i <= a.loop.slots; i++) {
      const ev = a.loop.events.find(e => e.slot === i);
      const b = el('button', {
        class: 'ogl-slot', type: 'button',
        'aria-label': `Slot ${i}${ev ? ', ' + ev.label : ''}`,
        onclick: () => this.#slotTo(i)
      },
        el('span', { class: 'ogl-slot-n', text: String(i) }),
        ev ? el('span', { class: 'ogl-slot-tag', text: ev.label }) : null
      );
      if (ev) b.classList.add('is-event-' + ev.tone);
      R.slotEls.push(b);
      R.slots.append(b);
    }
    R.eventNote = el('div', { class: 'ogl-eventnote', hidden: true });

    const clock = el('section', { class: 'ogl-clock', 'aria-label': 'Loop clock' },
      el('div', { class: 'ogl-clock-top' },
        el('span', { class: 'ogl-label', text: 'The clock' }),
        R.time,
        el('div', { class: 'ogl-clock-controls' },
          el('button', { class: 'ogl-btn', type: 'button', onclick: () => this.#slotTo(this.#state.slot - 1) },
            svg(ICON.prev), 'Back'),
          el('button', { class: 'ogl-btn', type: 'button', onclick: () => this.#slotTo(this.#state.slot + 1) },
            'Advance', svg(ICON.next)),
          R.undoBtn = el('button', { class: 'ogl-btn', type: 'button', disabled: true, onclick: () => this.#undoLast() },
            svg(ICON.undo), 'Undo'),
          el('button', { class: 'ogl-btn ogl-btn--ember', type: 'button', onclick: () => this.#resetLoop() },
            svg(ICON.fire), 'Burn the room')
        )
      ),
      R.slots, R.eventNote
    );

    /* perfect-run banner */
    R.perfect = el('div', { class: 'ogl-perfect', hidden: true },
      svg(ICON.check),
      el('div', {},
        el('div', { text: 'All four faults fixed in one loop.' }),
        el('span', { text: 'The toast lands. Qazrahin becomes visible at 8:00 and reaches for the fire anyway.' })
      )
    );

    /* faults */
    R.faultEls = {};
    const faults = el('div', { class: 'ogl-faults' });
    for (const f of a.faults) faults.append(this.#buildFault(f));

    /* influence */
    const inf = this.#buildInfluence();

    /* slot log */
    R.logWrap = el('div', { class: 'ogl-logwrap' });
    const log = el('section', { class: 'ogl-card' },
      el('span', { class: 'ogl-label', text: 'Slot allocation · this loop' }),
      R.logWrap
    );

    /* stat blocks */
    const sb = el('section', { class: 'ogl-card' },
      el('span', { class: 'ogl-label', text: 'Stat blocks' }),
      ...a.statblocks.map(s => this.#buildStat(s))
    );

    /* prompts */
    const pr = el('section', { class: 'ogl-card' },
      el('span', { class: 'ogl-label', text: 'GM prompts' }),
      ...a.prompts.map(p => {
        const body = el('div', { class: 'ogl-prompt-t', text: p.text, hidden: true });
        return el('button', {
          class: 'ogl-prompt', type: 'button', 'aria-expanded': 'false',
          onclick: (e) => {
            const open = body.hidden;
            body.hidden = !open;
            e.currentTarget.setAttribute('aria-expanded', String(open));
          }
        }, el('div', { class: 'ogl-prompt-l', text: p.label }), body);
      })
    );

    const foot = el('footer', { class: 'ogl-foot' },
      el('div', { class: 'ogl-keys' },
        el('kbd', { text: '←' }), el('kbd', { text: '→' }), 'slot',
        el('kbd', { text: 'R' }), 'burn the room',
        el('kbd', { text: 'U' }), 'undo'
      ),
      el('div', { class: 'ogl-head-spacer' }),
      el('div', { text: 'Known persists across loops. Fixed does not.' })
    );

    this.append(el('div', { class: 'ogl-shell' },
      R.live, head, clock, R.perfect,
      el('div', { class: 'ogl-cols' },
        el('div', { class: 'ogl-stack' },
          el('section', { class: 'ogl-card' },
            el('span', { class: 'ogl-label', text: 'The four faults' }), faults),
          log
        ),
        el('div', { class: 'ogl-stack' }, inf, sb, pr)
      ),
      foot
    ));
  }

  #buildFault(f) {
    const R = this.#refs;
    const detail = el('div', { class: 'ogl-fault-detail', hidden: true });

    detail.append(el('div', { class: 'ogl-detail-group' },
      el('span', { class: 'ogl-label', text: 'Discovery' }),
      el('ul', { class: 'ogl-detail-list' }, ...f.discovery.map(d => el('li', { text: d })))
    ));

    const routes = el('div', { class: 'ogl-detail-group' }, el('span', { class: 'ogl-label', text: 'Routes' }));
    for (const r of f.routes) {
      routes.append(el('div', { class: 'ogl-route' + (r.bad ? ' is-bad' : '') + (r.sticky ? ' is-sticky' : '') },
        el('div', { class: 'ogl-route-label', text: r.label }),
        el('div', { class: 'ogl-route-dc', text: r.dc }),
        r.note ? el('div', { class: 'ogl-route-note', text: r.note }) : null
      ));
    }
    detail.append(routes);

    const hasSticky = f.routes.some(r => r.sticky);
    let stickyBtn = null;
    if (hasSticky) {
      stickyBtn = el('button', {
        class: 'ogl-chip', type: 'button', 'aria-pressed': 'false',
        onclick: () => this.#commit(s => {
          s.sticky[f.id] = !s.sticky[f.id];
          if (s.sticky[f.id]) { s.fixed[f.id] = true; s.known[f.id] = true; }
        })
      }, 'Solved permanently');
      detail.append(el('div', { class: 'ogl-chips' }, stickyBtn));
    }

    const knownBtn = el('button', {
      class: 'ogl-pill ogl-pill--known', type: 'button', 'aria-pressed': 'false',
      title: 'The party knows about this. Persists across loops.',
      onclick: (e) => { e.stopPropagation(); this.#commit(s => { s.known[f.id] = !s.known[f.id]; }); }
    }, 'Known');

    const fixedBtn = el('button', {
      class: 'ogl-pill ogl-pill--fixed', type: 'button', 'aria-pressed': 'false',
      title: 'Fixed in the current loop. Resets when the room burns.',
      onclick: (e) => {
        e.stopPropagation();
        this.#commit(s => { s.fixed[f.id] = !s.fixed[f.id]; if (s.fixed[f.id]) s.known[f.id] = true; });
      }
    }, 'Fixed');

    // Pills are buttons, so the expander must be a sibling button, never a
    // parent — nested interactive controls are invalid and break keyboard nav.
    const toggle = el('button', {
      class: 'ogl-fault-toggle', type: 'button', 'aria-expanded': 'false',
      onclick: (e) => {
        const open = detail.hidden;
        detail.hidden = !open;
        e.currentTarget.setAttribute('aria-expanded', String(open));
      }
    },
      el('span', { class: 'ogl-fault-n', text: f.n }),
      el('span', { class: 'ogl-fault-body' },
        el('span', { class: 'ogl-fault-name', text: f.name }),
        el('span', { class: 'ogl-fault-sum', text: f.summary })
      )
    );

    const head = el('div', { class: 'ogl-fault-head' },
      toggle,
      el('div', { class: 'ogl-pills' }, knownBtn, fixedBtn)
    );

    const wrap = el('article', { class: 'ogl-fault' }, head, detail);
    R.faultEls[f.id] = { wrap, knownBtn, fixedBtn, stickyBtn };
    return wrap;
  }

  #buildInfluence() {
    const a = this.#adv, R = this.#refs, i = a.influence;

    R.infPts = el('div', { class: 'ogl-inf-pts ogl-num', text: '0' });
    R.infHW = el('div', { class: 'ogl-inf-hw', text: '' });

    const bump = (d) => this.#commit(s => {
      const n = Math.min(i.max, Math.max(0, s.influence.points + d));
      s.influence.points = n;
      if (n > s.influence.highWater) s.influence.highWater = n;
      const duke = a.faults.find(f => f.influence);
      if (duke) { s.fixed[duke.id] = n >= i.max; if (n > 0) s.known[duke.id] = true; }
    });

    R.rungs = i.thresholds.map(t => {
      const r = el('div', { class: 'ogl-rung' },
        el('span', { class: 'ogl-rung-at', text: String(t.at) }),
        el('span', { text: t.label }));
      return { at: t.at, node: r };
    });

    R.discChips = i.discovery.map(d => {
      const b = el('button', {
        class: 'ogl-chip', type: 'button', 'aria-pressed': 'false',
        onclick: () => this.#commit(s => {
          const set = new Set(s.influence.discovered);
          set.has(d.name) ? set.delete(d.name) : set.add(d.name);
          s.influence.discovered = [...set];
        })
      }, `${d.name} DC ${d.dc}`);
      return { name: d.name, node: b };
    });

    return el('section', { class: 'ogl-card' },
      el('span', { class: 'ogl-label', text: 'Influence' }),
      el('div', { class: 'ogl-inf-head' }, el('span', { class: 'ogl-inf-name', text: i.target })),
      el('div', { class: 'ogl-inf-stats', text: i.stats }),
      el('div', { class: 'ogl-inf-score' },
        R.infPts,
        el('span', { class: 'ogl-inf-max', text: '/ ' + i.max }),
        el('div', { class: 'ogl-step' },
          el('button', { type: 'button', 'aria-label': 'Lose an influence point', onclick: () => bump(-1) }, '−'),
          el('button', { type: 'button', 'aria-label': 'Gain an influence point', onclick: () => bump(1) }, '+')
        ),
        R.infHW
      ),
      el('div', { class: 'ogl-ladder' }, ...R.rungs.map(r => r.node)),
      el('div', { class: 'ogl-modline is-weak' },
        el('b', { text: i.weakness.mod }), el('span', { text: i.weakness.label })),
      el('div', { class: 'ogl-modline is-res' },
        el('b', { text: i.resistance.mod }), el('span', { text: i.resistance.label })),
      el('div', { class: 'ogl-detail-group ogl-mt' },
        el('span', { class: 'ogl-label', text: 'Influence skills' }),
        el('div', { class: 'ogl-chips' },
          ...i.skills.map(s => el('span', { class: 'ogl-chip', text: `${s.name} DC ${s.dc}` })))
      ),
      el('div', { class: 'ogl-detail-group ogl-mt' },
        el('span', { class: 'ogl-label', text: 'Discovered' }),
        el('div', { class: 'ogl-chips' }, ...R.discChips.map(c => c.node))
      ),
      el('div', { class: 'ogl-house' }, el('b', { text: 'House rule' }), i.houseRule)
    );
  }

  #buildStat(s) {
    const row = (k, v, cls) => el('div', { class: 'ogl-sb-row' },
      el('dt', { text: k }), el('dd', { class: cls || '', text: v }));
    return el('details', { class: 'ogl-det' },
      el('summary', {},
        el('span', { text: s.name }),
        el('span', { class: 'ogl-det-lvl', text: 'Lv ' + s.level }),
        el('span', { class: 'ogl-det-xp', text: s.xp })
      ),
      el('dl', { class: 'ogl-det-inner' },
        row('Defense', s.defense, 'ogl-sb-def'),
        row('Traits', s.traits.join(', ')),
        row('Immune', s.immune),
        s.resist !== '—' ? row('Resist', s.resist) : null,
        s.weak !== '—' ? row('Weak', s.weak) : null,
        row('Speed', s.speed),
        el('div', { class: 'ogl-sb-row' },
          el('dt', { text: 'Attacks' }),
          el('dd', {}, el('ul', { class: 'ogl-sb-list' }, ...s.attacks.map(x => el('li', { text: x }))))),
        el('div', { class: 'ogl-sb-row' },
          el('dt', { text: 'Abilities' }),
          el('dd', {}, el('ul', { class: 'ogl-sb-list' }, ...s.abilities.map(x => el('li', { text: x }))))),
        el('div', { class: 'ogl-sb-note', text: s.gmNote })
      )
    );
  }

  /* --- sync ------------------------------------------------------------- */

  #syncAll() { this.#syncClock(); this.#syncFaults(); this.#syncInfluence(); this.#syncLog(); }

  #syncClock() {
    const a = this.#adv, s = this.#state, R = this.#refs;
    R.loopN.textContent = String(s.loop);
    R.undoBtn.disabled = !this.#undo;

    const startMin = 51, cur = startMin + (s.slot - 1);
    const hh = cur >= 60 ? 8 : 7, mm = cur >= 60 ? cur - 60 : cur;
    R.time.textContent = `${hh}:${String(mm).padStart(2, '0')} PM  ·  slot ${s.slot} of ${a.loop.slots}`;

    R.slotEls.forEach((b, idx) => {
      const n = idx + 1;
      b.classList.toggle('is-past', n < s.slot);
      b.classList.toggle('is-now', n === s.slot);
      b.setAttribute('aria-current', n === s.slot ? 'step' : 'false');
    });

    const ev = a.loop.events.find(e => e.slot === s.slot);
    R.eventNote.hidden = !ev;
    if (ev) {
      R.eventNote.textContent = ev.note;
      R.eventNote.classList.toggle('is-ember', ev.tone === 'ember');
    }
  }

  #syncFaults() {
    const s = this.#state, R = this.#refs;
    let all = true;
    for (const f of this.#adv.faults) {
      const r = R.faultEls[f.id];
      const known = !!s.known[f.id], fixed = !!s.fixed[f.id];
      if (!fixed) all = false;
      r.wrap.classList.toggle('is-known', known && !fixed);
      r.wrap.classList.toggle('is-fixed', fixed);
      r.knownBtn.setAttribute('aria-pressed', String(known));
      r.fixedBtn.setAttribute('aria-pressed', String(fixed));
      if (r.stickyBtn) r.stickyBtn.setAttribute('aria-pressed', String(!!s.sticky[f.id]));
    }
    const wasHidden = R.perfect.hidden;
    R.perfect.hidden = !all;
    if (all && wasHidden) {
      this.#announce('All four faults fixed. The toast lands.');
      this.dispatchEvent(new CustomEvent('loop-console:perfect', {
        detail: { loop: s.loop }, bubbles: true, composed: true
      }));
    }
  }

  #syncInfluence() {
    const s = this.#state, R = this.#refs;
    const { points, highWater, discovered } = s.influence;
    R.infPts.textContent = String(points);
    R.infHW.textContent = highWater > 0 ? `best ${highWater} — restore for 1 slot` : '';
    for (const r of R.rungs) {
      r.node.classList.toggle('is-hit', points >= r.at);
      r.node.classList.toggle('is-earned', highWater >= r.at);
    }
    for (const c of R.discChips) c.node.setAttribute('aria-pressed', String(discovered.includes(c.name)));
  }

  #syncLog() {
    const a = this.#adv, s = this.#state, R = this.#refs;
    const key = String(s.loop);
    if (R.logLoop === key) { this.#syncLogState(); return; }
    R.logLoop = key;
    R.logWrap.textContent = '';

    const grid = el('div', { class: 'ogl-log' });
    R.logCells = [];
    grid.append(el('div', {}));
    R.logHeads = [];
    for (let i = 1; i <= a.loop.slots; i++) {
      const h = el('div', { class: 'ogl-log-h', text: String(i) });
      R.logHeads.push(h);
      grid.append(h);
    }

    s.party.forEach((name, pi) => {
      grid.append(el('input', {
        class: 'ogl-log-name', type: 'text', value: name,
        'aria-label': `Character ${pi + 1} name`,
        onchange: (e) => this.#commit(st => { st.party[pi] = e.target.value; })
      }));
      for (let sl = 1; sl <= a.loop.slots; sl++) {
        const val = s.log?.[key]?.[pi]?.[sl] || '';
        const ta = el('textarea', {
          class: 'ogl-log-cell', rows: '2', value: val,
          'aria-label': `${name}, slot ${sl}`,
          onchange: (e) => this.#commit(st => {
            st.log[key] ??= {}; st.log[key][pi] ??= {};
            st.log[key][pi][sl] = e.target.value;
          })
        });
        ta.value = val;
        R.logCells.push({ node: ta, slot: sl });
        grid.append(ta);
      }
    });
    R.logWrap.append(grid);
    this.#syncLogState();
  }

  #syncLogState() {
    const R = this.#refs, cur = this.#state.slot;
    R.logHeads?.forEach((h, i) => h.classList.toggle('is-now', i + 1 === cur));
    R.logCells?.forEach(c => {
      c.node.classList.toggle('is-now', c.slot === cur);
      c.node.classList.toggle('is-filled', c.node.value.trim().length > 0);
    });
  }
}

if (!customElements.get('loop-console')) customElements.define('loop-console', LoopConsole);
