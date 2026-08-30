/**
 * What to call a character that has not been named yet.
 *
 * The point of this module is that five places agree: the roster, the links
 * panel, the party panel, the shared screen and the sheet's own title bar. A
 * link labelled one thing and a row labelled another is how the wrong link gets
 * sent to the wrong player.
 */
import { describe, expect, it } from 'vitest';

import { displayName, isUnnamed } from '../../src/shared/character-name.js';

describe('naming', () => {
  it('uses the character’s own name when it has one', () => {
    expect(displayName({ name: 'Kestrel Vane', playerName: 'Alex' })).toBe('Kestrel Vane');
  });

  it('falls back to the player, phrased as belonging to them', () => {
    // Not a bare "Alex": in a list beside named characters that reads as a
    // character called Alex.
    expect(displayName({ name: '', playerName: 'Alex' })).toBe('Alex’s character');
  });

  it('gets the apostrophe right for a name ending in s', () => {
    expect(displayName({ playerName: 'Chris' })).toBe('Chris’ character');
    expect(displayName({ playerName: 'James' })).toBe('James’ character');
  });

  it('treats whitespace as no name at all', () => {
    expect(displayName({ name: '   ', playerName: 'Alex' })).toBe('Alex’s character');
    expect(displayName({ name: 'Kestrel', playerName: '  ' })).toBe('Kestrel');
  });

  it('always returns something', () => {
    for (const input of [{}, null, undefined, { name: null, playerName: null }, { name: '' }]) {
      expect(displayName(input)).toBe('Unnamed character');
    }
  });
});

describe('knowing it is unnamed', () => {
  it.each([
    [{ name: 'Kestrel' }, false],
    [{ name: '', playerName: 'Alex' }, true],
    [{ name: '  ' }, true],
    [{}, true],
    [null, true],
  ])('%o -> %s', (character, expected) => {
    expect(isUnnamed(character)).toBe(expected);
  });
});
