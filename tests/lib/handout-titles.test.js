/**
 * Shortening a list of handout names that all start the same way.
 *
 * The case this exists for is a real one: eight files out of one folder, seven
 * beginning "The Hall of Regrettable Artifacts" and the eighth beginning "Hall
 * of Regrettable Artifacts", so the strict common prefix across all of them is
 * the empty string. A GM ticking the right checkbox should not have to read
 * the tail of a wrapped line to tell the rows apart.
 */
import { describe, expect, it } from 'vitest';

import { displayTitles } from '../../public/assets/js/lib/handout-titles.js';

const of = (...titles) => titles.map((title, id) => ({ id, title }));
const shown = (handouts) => [...displayTitles(handouts).short.values()];

describe('the real set', () => {
  const real = of(
    "Hall of Regrettable Artifacts - Player's Guide.pdf",
    'The Hall of Regrettable Artifacts - Conditions of Custody.pdf',
    'The Hall of Regrettable Artifacts - Schedule of Leases in Force - Extract 1.pdf',
    "The Hall of Regrettable Artifacts - Surveyor's Plan.pdf",
  );

  it('finds the shared opening despite the stray definite article', () => {
    expect(displayTitles(real).shared).toBe('Hall of Regrettable Artifacts');
  });

  it('leaves each row with only what tells it apart', () => {
    expect(shown(real)).toEqual([
      "Player's Guide",
      'Conditions of Custody',
      'Schedule of Leases in Force - Extract 1',
      "Surveyor's Plan",
    ]);
  });
});

describe('when it should do nothing', () => {
  it('leaves a single handout alone', () => {
    expect(shown(of('The Map.pdf'))).toEqual(['The Map']);
    expect(displayTitles(of('The Map.pdf')).shared).toBe('');
  });

  it('leaves unrelated names alone', () => {
    expect(displayTitles(of('Map.pdf', 'Letter.pdf', 'Ledger.pdf')).shared).toBe('');
  });

  it('refuses a prefix so long it would empty a row', () => {
    const { shared, short } = displayTitles(of('Extract.pdf', 'Extract 1.pdf'));
    expect(shared).toBe('');
    expect([...short.values()]).toEqual(['Extract', 'Extract 1']);
  });

  it('will not cut a word in half', () => {
    expect(displayTitles(of('Chapter One.pdf', 'Chapter Two.pdf')).shared).toBe('');
  });

  it('drops the extension even when nothing is shared', () => {
    expect(shown(of('Map.png', 'Notes.md', 'Scan.JPEG'))).toEqual(['Map', 'Notes', 'Scan']);
  });
});
