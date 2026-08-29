/**
 * The sheet's local-first store.
 *
 * These are the behaviours a player at a table actually depends on: nothing is
 * lost when the signal drops, nothing is lost when the tab is reloaded, and the
 * GM pushing a condition does not eat a note being typed. They are tested in
 * Node against a stub fetch, because the failure modes are about ordering and
 * timing rather than about the DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore, leafPaths, readPath, STATUS, writePath } from '../../public/assets/js/sheet/store.js';

/** A localStorage that behaves like the real one, including throwing. */
function makeStorage({ throws = false } = {}) {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { if (throws) throw new Error('quota'); map.set(k, v); },
    removeItem: (k) => map.delete(k),
    get size() { return map.size; },
  };
}

/** A server that can be taken offline and that records what it was sent. */
function makeServer(initial = {}) {
  const server = {
    online: true,
    sheet: initial.sheet ?? {},
    versions: initial.versions ?? {},
    requests: [],
    conflictOn: null,
  };

  server.fetch = async (url, options = {}) => {
    if (!server.online) throw new TypeError('Failed to fetch');
    server.requests.push({ method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : null });

    if ((options.method ?? 'GET') === 'GET') {
      return {
        ok: true,
        json: async () => ({
          character: { id: 1, name: 'Kestrel', sheet: structuredClone(server.sheet) },
          campaign: { id: 1, name: 'Tuesday', accentColor: '#667EEA' },
          versions: structuredClone(server.versions),
        }),
      };
    }

    const applied = [];
    const conflicts = [];
    for (const write of JSON.parse(options.body).writes) {
      const current = server.versions[write.path]?.version ?? 0;
      const stale = write.baseVersion !== undefined && write.baseVersion !== null
        && write.baseVersion !== current;
      if (stale || server.conflictOn === write.path) {
        conflicts.push({
          path: write.path,
          expectedVersion: write.baseVersion,
          currentVersion: current,
          currentValue: readPath(server.sheet, write.path) ?? null,
        });
        continue;
      }
      writePath(server.sheet, write.path, write.value);
      server.versions[write.path] = { version: current + 1, updatedBy: 'player' };
      applied.push({ path: write.path, version: current + 1 });
    }

    return {
      ok: true,
      json: async () => ({
        character: { id: 1, name: 'Kestrel', sheet: structuredClone(server.sheet) },
        versions: structuredClone(server.versions),
        applied,
        conflicts,
      }),
    };
  };

  return server;
}

/**
 * Advance past the save debounce and let the request settle.
 *
 * Bounded rather than `runAllTimersAsync`, because a store that is offline
 * reschedules its own retry forever -- which is correct behaviour, and would
 * otherwise look like an infinite loop to the test runner.
 */
const settle = async () => {
  await vi.advanceTimersByTimeAsync(2000);
  await Promise.resolve();
};

let storage;
let server;
let store;

beforeEach(() => {
  vi.useFakeTimers();
  storage = makeStorage();
  server = makeServer({ sheet: { name: 'Kestrel', hp: { current: 40, max: 48 }, notes: '' } });
  store = createStore({ endpoint: '/api/c/T', storageKey: 'T', fetchImpl: server.fetch, storage });
});

afterEach(() => { vi.useRealTimers(); });

describe('loading', () => {
  it('takes the server’s copy', async () => {
    await store.load();
    expect(store.sheet.name).toBe('Kestrel');
    expect(store.state.status).toBe(STATUS.saved);
  });

  it('falls back to the local copy when the server is unreachable', async () => {
    await store.load();
    store.set('notes', 'written while online');
    await settle();

    const offline = makeServer();
    offline.online = false;
    const second = createStore({
      endpoint: '/api/c/T', storageKey: 'T', fetchImpl: offline.fetch, storage,
    });
    await second.load();

    expect(second.sheet.notes).toBe('written while online');
    expect(second.state.status).toBe(STATUS.offline);
  });
});

describe('writing', () => {
  it('applies locally before the network is touched at all', async () => {
    await store.load();
    server.online = false;
    store.set('hp.current', 31);
    // No await: the value is there synchronously.
    expect(store.sheet.hp.current).toBe(31);
    expect(store.state.status).toBe(STATUS.pending);
  });

  it('debounces, so typing sends one request rather than one per keystroke', async () => {
    await store.load();
    const before = server.requests.length;
    for (const value of ['a', 'ab', 'abc', 'abcd']) store.set('notes', value);
    await settle();
    expect(server.requests.length - before).toBe(1);
    expect(server.sheet.notes).toBe('abcd');
  });

  it('ignores a write that changes nothing', async () => {
    await store.load();
    const before = server.requests.length;
    store.set('name', 'Kestrel');
    await settle();
    expect(server.requests.length).toBe(before);
  });

  it('bases a write on the version at the first unsent edit, not the latest', async () => {
    await store.load();
    store.set('notes', 'one');
    await settle();
    // Version is now 1. Two further edits before a flush must both be based on
    // 1, not on 1 then 2 -- the server has never told us about a version 2.
    store.set('notes', 'two');
    store.set('notes', 'three');
    await settle();
    expect(server.sheet.notes).toBe('three');
    expect(store.state.conflicts).toEqual([]);
  });
});

describe('losing the connection', () => {
  it('keeps every edit and sends them when it comes back', async () => {
    await store.load();
    server.online = false;

    store.set('notes', 'written in a cellar');
    store.set('hp.current', 12);
    await settle();
    expect(store.state.status).toBe(STATUS.offline);
    expect(store.state.pendingPaths.sort()).toEqual(['hp.current', 'notes']);

    server.online = true;
    await store.flush();
    await settle();

    expect(server.sheet.notes).toBe('written in a cellar');
    expect(server.sheet.hp.current).toBe(12);
    expect(store.state.status).toBe(STATUS.saved);
  });

  it('survives the tab being closed and reopened offline', async () => {
    await store.load();
    server.online = false;
    store.set('notes', 'mid-sentence');
    await settle();

    // A new store, same storage: this is a reload.
    const reopened = createStore({
      endpoint: '/api/c/T', storageKey: 'T', fetchImpl: server.fetch, storage,
    });
    await reopened.load();
    expect(reopened.sheet.notes).toBe('mid-sentence');
    expect(reopened.state.pendingPaths).toEqual(['notes']);

    server.online = true;
    await reopened.flush();
    await settle();
    expect(server.sheet.notes).toBe('mid-sentence');
  });

  it('re-applies queued edits on top of the server’s copy when loading', async () => {
    await store.load();
    server.online = false;
    store.set('notes', 'mine');
    await settle();

    // Somebody else changed a different field while we were away.
    server.sheet.name = 'Kestrel Vane';
    server.online = true;

    const reopened = createStore({
      endpoint: '/api/c/T', storageKey: 'T', fetchImpl: server.fetch, storage,
    });
    await reopened.load();
    expect(reopened.sheet.name).toBe('Kestrel Vane');
    expect(reopened.sheet.notes).toBe('mine');
  });

  it('backs off rather than hammering a server that is down', async () => {
    await store.load();
    server.online = false;
    store.set('notes', 'x');
    await vi.advanceTimersByTimeAsync(1000);
    const first = server.requests.length;
    await vi.advanceTimersByTimeAsync(60_000);
    const attempts = server.requests.length - first;
    // Sixty seconds of exponential backoff is a handful of tries, not sixty.
    expect(attempts).toBeLessThan(10);
  });

  it('keeps working when localStorage refuses to store anything', async () => {
    const hostile = makeStorage({ throws: true });
    const s = createStore({
      endpoint: '/api/c/T', storageKey: 'T', fetchImpl: server.fetch, storage: hostile,
    });
    await s.load();
    s.set('notes', 'private browsing');
    await settle();
    expect(server.sheet.notes).toBe('private browsing');
  });
});

describe('a field changed elsewhere', () => {
  it('reports the conflict for that path alone and applies the rest', async () => {
    await store.load();
    server.conflictOn = 'notes';
    store.set('notes', 'mine');
    store.set('hp.current', 22);
    await settle();

    expect(store.state.status).toBe(STATUS.conflict);
    expect(store.state.conflicts.map((c) => c.path)).toEqual(['notes']);
    expect(server.sheet.hp.current).toBe(22);
  });

  it('adopts the server’s value but keeps mine on the conflict', async () => {
    await store.load();
    server.sheet.notes = 'the GM wrote this';
    server.conflictOn = 'notes';
    store.set('notes', 'I wrote this');
    await settle();

    expect(store.sheet.notes).toBe('the GM wrote this');
    expect(store.state.conflicts[0].localValue).toBe('I wrote this');
  });

  it('can put mine back deliberately', async () => {
    await store.load();
    server.sheet.notes = 'theirs';
    server.conflictOn = 'notes';
    store.set('notes', 'mine');
    await settle();

    server.conflictOn = null;
    store.keepLocal('notes');
    await settle();

    expect(store.sheet.notes).toBe('mine');
    expect(server.sheet.notes).toBe('mine');
    expect(store.state.conflicts).toEqual([]);
  });

  it('can keep theirs and stop being told about it', async () => {
    await store.load();
    server.conflictOn = 'notes';
    store.set('notes', 'mine');
    await settle();
    store.dismissConflict('notes');
    expect(store.state.conflicts).toEqual([]);
  });
});

describe('undo', () => {
  it('puts the previous value back', async () => {
    await store.load();
    store.set('notes', 'first');
    store.set('notes', 'second');
    expect(store.undo()).toBe(true);
    expect(store.sheet.notes).toBe('first');
    expect(store.undo()).toBe(true);
    expect(store.sheet.notes).toBe('');
  });

  it('reports that there is nothing left to undo', async () => {
    await store.load();
    expect(store.undo()).toBe(false);
    expect(store.state.canUndo).toBe(false);
  });

  it('does not stack an undo of an undo', async () => {
    await store.load();
    store.set('notes', 'typed');
    store.undo();
    expect(store.state.canUndo).toBe(false);
  });
});

describe('paths', () => {
  it('reads and writes dotted paths, creating what is missing', () => {
    const object = {};
    writePath(object, 'a.b.c', 1);
    expect(object).toEqual({ a: { b: { c: 1 } } });
    expect(readPath(object, 'a.b.c')).toBe(1);
    expect(readPath(object, 'a.x.y')).toBeUndefined();
  });

  it('treats an array as a leaf, so a list is written whole', () => {
    expect(leafPaths({ a: { b: 1 }, list: [1, 2] }).sort()).toEqual(['a.b', 'list']);
  });
});
