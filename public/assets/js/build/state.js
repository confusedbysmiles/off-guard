/**
 * The builder's store.
 *
 * Deliberately simpler than the sheet's. The sheet is used one-handed on a
 * phone with two bars of signal mid-sentence, so every write there lands
 * locally first and the network is an afterthought. Building a character is the
 * opposite posture -- two hands, a lot of reading, and almost always a real
 * connection -- so the server stays the single copy of the arithmetic and the
 * view re-renders from what it sends back.
 *
 * That is the important property here: the browser never derives a statistic.
 * It holds the *choices*, sends them, and renders the derivation it is given.
 * A builder that computed its own preview would be a second implementation of
 * the rules, and the two would disagree on exactly the character that made
 * someone open the builder in the first place.
 *
 * The choices themselves are mirrored into localStorage, so a closed tab or a
 * dropped connection loses nothing a player typed.
 */

const DRAFT_KEY = 'off-guard:build';
const SAVE_DEBOUNCE = 500;

export const STATUS = {
  ready: 'ready',
  saving: 'saving',
  pending: 'pending',
  offline: 'offline',
  error: 'error',
};

/**
 * @param {string} endpoint  the character API base -- the same one the sheet
 *   uses and the same one the picker is given. The builder's own routes hang
 *   off it, so callers pass one base rather than three URLs that must agree.
 */
export function createBuildStore({ endpoint, storageKey = '', fetchImpl = globalThis.fetch, storage = globalThis.localStorage }) {
  const builderUrl = `${endpoint}/builder`;
  const draftKey = `${DRAFT_KEY}:${storageKey}`;
  const listeners = new Set();

  let build = null;
  let derived = null;      // sheet, problems, slots, byLevel, outstanding, missing
  let character = null;
  let catalogue = null;
  let status = STATUS.ready;
  let lastError = null;
  let saveTimer = null;
  let inFlight = false;
  let dirty = false;

  const state = () => ({ build, derived, character, catalogue, status, lastError, dirty });

  function notify() {
    const snapshot = state();
    for (const listener of listeners) listener(snapshot);
  }

  function setStatus(next) {
    if (status === next) return;
    status = next;
    notify();
  }

  function persist() {
    try { storage.setItem(draftKey, JSON.stringify(build)); } catch { /* private mode */ }
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(state());
    return () => listeners.delete(listener);
  }

  async function load() {
    try {
      const res = await fetchImpl(builderUrl, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`Server said ${res.status}`);
      const body = await res.json();
      build = body.build;
      catalogue = body.catalogue ?? null;
      adopt(body);

      /**
       * A draft that never reached the server wins, and is saved immediately.
       * It is by definition newer than what the server holds, and the player
       * has no other copy of it.
       */
      const draft = readDraft();
      if (draft && JSON.stringify(draft) !== JSON.stringify(build)) {
        build = draft;
        dirty = true;
        notify();
        schedule(0);
      }
    } catch (error) {
      lastError = error.message;
      setStatus(STATUS.error);
    }
  }

  function readDraft() {
    try { return JSON.parse(storage.getItem(draftKey) ?? 'null'); } catch { return null; }
  }

  /** Adopt a server response: it is the authority on everything derived. */
  function adopt(body) {
    derived = {
      sheet: body.sheet ?? derived?.sheet ?? {},
      problems: body.problems ?? [],
      slots: body.slots ?? [],
      byLevel: body.byLevel ?? {},
      outstanding: body.outstanding ?? 0,
      missing: body.missing ?? [],
      items: body.items ?? {},
      level: body.level ?? build?.level ?? 1,
      planTo: body.planTo ?? body.level ?? 1,
      proficiencies: body.proficiencies ?? null,
      attributes: body.attributes ?? null,
      skillAllowance: body.skillAllowance ?? null,
    };
    setStatus(STATUS.ready);
    notify();
  }

  /**
   * Change the build.
   *
   * `mutate` is handed a copy to edit, so a caller cannot accidentally leave
   * the store holding a half-applied change if it throws partway through.
   *
   * `immediate` is the difference between a discrete choice and typing. Picking
   * an ancestry has to redraw the timeline -- a dwarf gains a boost to choose
   * that a human does not -- and the redraw comes from the server, so a
   * debounce here is half a second in which the click appears to have done
   * nothing. Only the name field wants waiting for.
   */
  function update(mutate, { immediate = true } = {}) {
    const next = structuredClone(build ?? {});
    mutate(next);
    if (JSON.stringify(next) === JSON.stringify(build)) return;
    build = next;
    dirty = true;
    persist();
    setStatus(STATUS.pending);
    notify();
    schedule(immediate ? 0 : SAVE_DEBOUNCE);
  }

  function schedule(delay) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, delay);
  }

  async function save() {
    if (inFlight || !dirty) return;
    inFlight = true;
    const sending = build;
    setStatus(STATUS.saving);

    try {
      const res = await fetchImpl(builderUrl, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ build: sending }),
      });
      if (!res.ok) throw new Error(`Server said ${res.status}`);
      const body = await res.json();

      character = body.character ?? character;
      // Only clean if nothing was changed while the request was in the air.
      if (JSON.stringify(sending) === JSON.stringify(build)) {
        dirty = false;
        try { storage.removeItem(draftKey); } catch { /* private mode */ }
      }
      adopt(body.builder ?? {});
      lastError = null;
      if (dirty) schedule(SAVE_DEBOUNCE);
    } catch (error) {
      lastError = error.message;
      setStatus(STATUS.offline);
      // The draft is already in localStorage, so a failed save costs nothing
      // but the delay before the next attempt.
      schedule(5000);
    } finally {
      inFlight = false;
    }
  }

  return {
    subscribe,
    load,
    update,
    save,
    flush: () => { clearTimeout(saveTimer); return save(); },
    get build() { return build; },
    get derived() { return derived; },
    get state() { return state(); },
  };
}
