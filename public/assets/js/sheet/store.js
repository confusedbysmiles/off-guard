/**
 * The sheet's local-first store.
 *
 * The phone at the table has two bars of signal and the player is mid-sentence.
 * So every write lands locally first and is only then queued for the server:
 *
 *   1. `set()` updates the in-memory sheet and notifies the view immediately.
 *      Nothing waits on the network, ever.
 *   2. The write joins a queue that is mirrored into localStorage, so closing
 *      the tab, losing signal or reloading does not lose what was typed.
 *   3. A debounced flush sends the queue with the version each write was based
 *      on. The server applies what is still current and reports the rest.
 *
 * Per-field versioning is what makes a GM pushing a condition and a player
 * typing a note not collide: they are different paths, so both apply. A genuine
 * same-path conflict adopts the server's value -- it is the one everyone else
 * can see -- and hands the local value back to the view so the player can put
 * it back deliberately rather than having it vanish.
 */

const QUEUE_KEY = 'off-guard:queue';
const SHEET_KEY = 'off-guard:sheet';
const SAVE_DEBOUNCE = 700;
const MAX_BACKOFF = 30_000;

export const STATUS = {
  saved: 'saved',
  saving: 'saving',
  pending: 'pending',
  offline: 'offline',
  conflict: 'conflict',
  error: 'error',
};

export function readPath(object, path) {
  return String(path).split('.').reduce(
    (node, key) => (node === null || node === undefined ? undefined : node[key]),
    object,
  );
}

export function writePath(object, path, value) {
  const keys = String(path).split('.');
  const last = keys.pop();
  let node = object;
  for (const key of keys) {
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
    node = node[key];
  }
  node[last] = value;
  return object;
}

export function createStore({ endpoint, storageKey = '', fetchImpl = globalThis.fetch, storage = globalThis.localStorage }) {
  const queueKey = `${QUEUE_KEY}:${storageKey}`;
  const sheetKey = `${SHEET_KEY}:${storageKey}`;

  const listeners = new Set();
  const undoStack = [];

  let sheet = {};
  let versions = {};
  let character = null;
  let campaign = null;
  let status = STATUS.saved;
  let conflicts = [];
  let lastError = null;
  let queue = restore(queueKey) ?? {};
  let flushTimer = null;
  let backoff = 1000;
  let inFlight = false;

  function restore(key) {
    try { return JSON.parse(storage.getItem(key) ?? 'null'); } catch { return null; }
  }
  function persist(key, value) {
    try { storage.setItem(key, JSON.stringify(value)); } catch { /* private mode; memory only */ }
  }

  const state = () => ({
    sheet, versions, character, campaign, status, conflicts, lastError,
    pendingPaths: Object.keys(queue),
    canUndo: undoStack.length > 0,
  });

  function notify() {
    const snapshot = state();
    for (const listener of listeners) listener(snapshot);
  }

  function setStatus(next) {
    if (status === next) return;
    status = next;
    notify();
  }

  /** Everything the view needs, and the only way in. */
  function subscribe(listener) {
    listeners.add(listener);
    listener(state());
    return () => listeners.delete(listener);
  }

  async function load() {
    // Anything queued from a previous session is replayed before the server's
    // copy is trusted, so a reload while offline does not silently discard it.
    const offlineSheet = restore(sheetKey);
    if (offlineSheet) {
      sheet = offlineSheet.sheet ?? {};
      versions = offlineSheet.versions ?? {};
      character = offlineSheet.character ?? null;
      campaign = offlineSheet.campaign ?? null;
      setStatus(Object.keys(queue).length ? STATUS.pending : STATUS.saved);
      notify();
    }

    try {
      const res = await fetchImpl(endpoint, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`Server said ${res.status}`);
      const body = await res.json();
      character = body.character;
      campaign = body.campaign;
      versions = body.versions ?? {};
      sheet = body.character.sheet ?? {};
      // Local edits that have not reached the server yet are re-applied on top
      // of the server's copy, so loading never looks like losing work.
      for (const [path, write] of Object.entries(queue)) writePath(sheet, path, write.value);
      persist(sheetKey, { sheet, versions, character, campaign });
      setStatus(Object.keys(queue).length ? STATUS.pending : STATUS.saved);
      notify();
      if (Object.keys(queue).length) schedule(0);
    } catch (error) {
      lastError = error.message;
      setStatus(offlineSheet ? STATUS.offline : STATUS.error);
    }
  }

  /**
   * Write one field.
   * `remember: false` keeps it out of the undo stack, for programmatic writes.
   */
  function set(path, value, { remember = true } = {}) {
    const previous = readPath(sheet, path);
    if (JSON.stringify(previous) === JSON.stringify(value)) return;

    if (remember) undoStack.push({ path, value: previous });
    writePath(sheet, path, value);

    // The version a write is based on is the version at the time of the *first*
    // unsent edit to that path. Re-reading it on every keystroke would base the
    // write on a version the server has never sent us.
    const existing = queue[path];
    queue[path] = {
      value,
      baseVersion: existing ? existing.baseVersion : (versions[path]?.version ?? 0),
    };

    persist(queueKey, queue);
    persist(sheetKey, { sheet, versions, character, campaign });
    setStatus(STATUS.pending);
    notify();
    schedule(SAVE_DEBOUNCE);
  }

  function undo() {
    const last = undoStack.pop();
    if (!last) return false;
    set(last.path, last.value, { remember: false });
    return true;
  }

  function schedule(delay) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, delay);
  }

  /** Send everything queued. Safe to call at any time; it no-ops when idle. */
  async function flush() {
    if (inFlight) return;
    const writes = Object.entries(queue).map(([path, write]) => ({ path, ...write }));
    if (!writes.length) {
      setStatus(conflicts.length ? STATUS.conflict : STATUS.saved);
      return;
    }

    inFlight = true;
    setStatus(STATUS.saving);

    try {
      const res = await fetchImpl(endpoint, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ writes }),
      });
      if (!res.ok) throw new Error(`Server said ${res.status}`);
      const body = await res.json();

      versions = body.versions ?? versions;
      character = body.character ?? character;

      for (const { path } of body.applied ?? []) {
        // Only drop the queued write if nothing was typed into that field while
        // the request was in the air.
        if (queue[path] && JSON.stringify(queue[path].value) === JSON.stringify(readPath(sheet, path))) {
          delete queue[path];
        }
      }

      conflicts = (body.conflicts ?? []).map((conflict) => ({
        ...conflict,
        localValue: queue[conflict.path]?.value ?? readPath(sheet, conflict.path),
      }));

      for (const conflict of conflicts) {
        // Adopt the server's value: it is the one the GM and the rest of the
        // table can see. The local one is kept on the conflict so the view can
        // offer it back rather than throwing it away.
        writePath(sheet, conflict.path, conflict.currentValue);
        delete queue[conflict.path];
      }

      persist(queueKey, queue);
      persist(sheetKey, { sheet, versions, character, campaign });
      backoff = 1000;
      lastError = null;
      setStatus(conflicts.length ? STATUS.conflict : (Object.keys(queue).length ? STATUS.pending : STATUS.saved));
      notify();
      if (Object.keys(queue).length) schedule(SAVE_DEBOUNCE);
    } catch (error) {
      lastError = error.message;
      setStatus(STATUS.offline);
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
      schedule(backoff);
    } finally {
      inFlight = false;
    }
  }

  /** Re-apply a local value the server rejected, on top of the current version. */
  function keepLocal(path) {
    const conflict = conflicts.find((c) => c.path === path);
    if (!conflict) return;
    conflicts = conflicts.filter((c) => c.path !== path);
    versions = { ...versions, [path]: { ...(versions[path] ?? {}), version: conflict.currentVersion } };
    set(path, conflict.localValue, { remember: false });
  }

  function dismissConflict(path) {
    conflicts = conflicts.filter((c) => c.path !== path);
    setStatus(conflicts.length ? STATUS.conflict : status);
    notify();
  }

  /** Replace the whole sheet, for a Pathbuilder import. */
  function replaceAll(nextSheet) {
    const paths = leafPaths(nextSheet);
    for (const path of paths) set(path, readPath(nextSheet, path), { remember: false });
    schedule(0);
  }

  return {
    subscribe, load, set, undo, flush, keepLocal, dismissConflict, replaceAll,
    get state() { return state(); },
    get sheet() { return sheet; },
  };
}

/** Every dotted path to a non-object value. Arrays are leaves. */
export function leafPaths(object, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(object ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) out.push(...leafPaths(value, path));
    else out.push(path);
  }
  return out;
}
