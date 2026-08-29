/**
 * The keyboard table, held to the dashboard that uses it.
 *
 * `shortcuts.js` has two readers: `main.js` dispatches keystrokes from it, and
 * the Start here tab prints it. The failure this guards against is the one a
 * help page always eventually has — naming a key that does nothing, or a key
 * quietly changing and the page still claiming the old one. Neither is
 * catchable by reading either file on its own.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  matchesKey, shortcutFor, SHORTCUT_GROUPS, SHORTCUTS, TABS,
} from '../../public/assets/js/gm/shortcuts.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = source('../../public/assets/js/gm/main.js');

/** The ids `main.js` has an action for, read out of `SHORTCUT_ACTIONS`. */
const actionIds = () => {
  const block = main.slice(
    main.indexOf('export const SHORTCUT_ACTIONS = {'),
    main.indexOf('function setUpKeyboard()'),
  );
  const ids = [...block.matchAll(/^\s+'([a-z]+:[a-zA-Z]+)':/gm)].map(([, id]) => id);
  // The tab actions are generated from TABS rather than written out.
  return new Set([...ids, ...TABS.map(([id]) => `tab:${id}`)]);
};

describe('every shortcut', () => {
  it('has an action in the dashboard', () => {
    const actions = actionIds();
    for (const shortcut of SHORTCUTS) {
      expect(actions.has(shortcut.id), `${shortcut.id} is described but does nothing`).toBe(true);
    }
  });

  it('is described by the table the Start here tab prints', () => {
    const actions = actionIds();
    const described = new Set(SHORTCUTS.map((s) => s.id));
    for (const id of actions) {
      expect(described.has(id), `${id} does something but is not described`).toBe(true);
    }
  });

  it('has a key, a group and something to call it', () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys.length, `${shortcut.id} has no key`).toBeGreaterThan(0);
      expect(SHORTCUT_GROUPS).toContain(shortcut.group);
      expect(shortcut.label?.length, `${shortcut.id} has no label`).toBeGreaterThan(0);
    }
  });

  it('does not claim a key twice in the same place', () => {
    // Two shortcuts on one key is a bug wherever they can both be live, which
    // is anywhere their `when` overlaps.
    const seen = new Map();
    for (const shortcut of SHORTCUTS) {
      for (const key of shortcut.keys) {
        const scope = shortcut.when ?? '*';
        for (const [other, otherScope] of seen.get(key) ?? []) {
          const overlap = scope === '*' || otherScope === '*' || scope === otherScope;
          expect(overlap, `${key} is claimed by both ${other} and ${shortcut.id}`).toBe(false);
        }
        seen.set(key, [...(seen.get(key) ?? []), [shortcut.id, scope]]);
      }
    }
  });
});

describe('matching a keystroke', () => {
  const press = (key) => ({ key });

  it.each([
    ['T', press('t'), 'tab:table'],
    ['?', press('?'), 'tab:start'],
    ['R', press('r'), 'drawer:reference'],
    ['Esc', press('Escape'), 'drawer:close'],
  ])('%s fires %s', (_label, event, id) => {
    expect(shortcutFor(event, 'table')?.id).toBe(id);
  });

  it('holds the fight keys to the Initiative tab', () => {
    expect(shortcutFor(press(' '), 'initiative')?.id).toBe('combat:next');
    expect(shortcutFor(press('p'), 'initiative')?.id).toBe('combat:previous');
    // On any other tab P is free, and the space bar is the browser's.
    expect(shortcutFor(press(' '), 'table')).toBeNull();
    expect(shortcutFor(press('p'), 'table')).toBeNull();
  });

  it('does not treat the ellipsis in "1 … 9" as a key', () => {
    expect(matchesKey('…', press('…'))).toBe(false);
    // Digits are handled where the campaign list is known, not here.
    expect(shortcutFor(press('1'), 'table')).toBeNull();
  });

  it('is case-insensitive, because Caps Lock is a thing', () => {
    expect(shortcutFor(press('T'), 'table')?.id).toBe('tab:table');
  });
});

describe('the tabs', () => {
  it('all have a key, and no two share one', () => {
    const keys = TABS.map(([, , key]) => key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [id, label, key] of TABS) {
      expect(key, `${id} has no key`).toBeTruthy();
      expect(label, `${id} has no label`).toBeTruthy();
    }
  });

  it('are the tabs the dashboard renders', () => {
    // Each has a branch in `render()`; `table` is the fallthrough default.
    for (const [id] of TABS) {
      if (id === 'table') continue;
      expect(main, `render() has no branch for ${id}`).toContain(`state.tab === '${id}'`);
    }
  });
});
