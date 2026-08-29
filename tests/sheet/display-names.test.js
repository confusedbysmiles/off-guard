/**
 * Automatic display names: "Goblin A", "Goblin B".
 *
 * The rule that matters is the second one -- a GM who has renamed a row keeps
 * that name when another goblin joins, because renaming a creature is how you
 * remember which one is standing on the stairs.
 */
import { describe, expect, it } from 'vitest';

import { assignDisplayNames } from '../../public/assets/js/gm/views/builder.js';

const names = { 'goblin-warrior': 'Goblin Warrior', 'ogre-warrior': 'Ogre Warrior' };
const nameOf = (id) => names[id];
const run = (rows) => assignDisplayNames(rows, nameOf).map((r) => r.displayName);

describe('naming the creatures in an encounter', () => {
  it('leaves a lone creature unlettered', () => {
    expect(run([{ creatureId: 'goblin-warrior', count: 1 }])).toEqual(['Goblin Warrior']);
  });

  it('letters duplicates', () => {
    expect(run([
      { creatureId: 'goblin-warrior', count: 1 },
      { creatureId: 'goblin-warrior', count: 1 },
      { creatureId: 'goblin-warrior', count: 1 },
    ])).toEqual(['Goblin Warrior A', 'Goblin Warrior B', 'Goblin Warrior C']);
  });

  it('does not letter a single row, however many it stands for', () => {
    // The count says three. The three individual goblins are lettered when the
    // fight starts, not here -- doing both produced "Goblin A B".
    expect(run([{ creatureId: 'goblin-warrior', count: 3 }])).toEqual(['Goblin Warrior']);
  });

  it('counts each kind separately', () => {
    expect(run([
      { creatureId: 'goblin-warrior', count: 1 },
      { creatureId: 'ogre-warrior', count: 1 },
      { creatureId: 'goblin-warrior', count: 1 },
    ])).toEqual(['Goblin Warrior A', 'Ogre Warrior', 'Goblin Warrior B']);
  });

  it('never renames a row the GM named', () => {
    const rows = [
      { creatureId: 'goblin-warrior', count: 1, displayName: 'The one on the stairs', renamed: true },
      { creatureId: 'goblin-warrior', count: 1 },
      { creatureId: 'goblin-warrior', count: 1 },
    ];
    expect(run(rows)).toEqual(['The one on the stairs', 'Goblin Warrior A', 'Goblin Warrior B']);
  });

  it('falls back to the id when the catalogue has no name for it', () => {
    expect(run([{ creatureId: 'homebrew-thing', count: 1 }])).toEqual(['homebrew-thing']);
  });
});
