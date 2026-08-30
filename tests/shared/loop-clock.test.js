/**
 * The clock.
 *
 * Two screens show it now -- the GM advances it on the dashboard, the room
 * reads it off the television -- so the arithmetic is shared. A minute that
 * disagrees between the two is the one thing nobody at the table can settle by
 * looking harder.
 */
import { describe, expect, it } from 'vitest';

import { clockFace, eventAt } from '../../src/shared/loop.js';
import { ADVENTURE } from '../../src/shared/adventures/nine-minutes.js';

describe('Nine Minutes to the Toast', () => {
  it.each([[1, '7:51'], [2, '7:52'], [7, '7:57'], [9, '7:59']])(
    'slot %i reads %s',
    (slot, text) => {
      expect(clockFace(ADVENTURE, slot)).toEqual({ text, suffix: 'PM' });
    },
  );

  it('names the event on the minute it fires, and nothing on the others', () => {
    expect(eventAt(ADVENTURE, 7).label).toBe('Aspic');
    expect(eventAt(ADVENTURE, 9).label).toBe('Toast');
    expect(eventAt(ADVENTURE, 8)).toBeNull();
  });
});

describe('the start time comes from the adventure', () => {
  // It used to be a constant in the dashboard view, which meant a second
  // adventure would have quietly run on this one's clock.
  const at = (startLabel, slot) => clockFace({ loop: { startLabel } }, slot).text;

  it.each([
    ['11:58', 1, '11:58'],
    ['11:58', 3, '12:00'],
    ['9:30', 1, '9:30'],
    ['9:30', 31, '10:00'],
  ])('%s at slot %i reads %s', (startLabel, slot, expected) => {
    expect(at(startLabel, slot)).toBe(expected);
  });

  it('reads a bare hour as the evening, and rolls into the small hours', () => {
    // These labels carry no AM or PM -- "7:51" is a dinner party, not a
    // breakfast one -- so an hour before noon is read as the evening. A loop
    // that runs past midnight keeps counting rather than jumping back twelve
    // hours.
    expect(clockFace({ loop: { startLabel: '11:59' } }, 1)).toEqual({ text: '11:59', suffix: 'PM' });
    expect(clockFace({ loop: { startLabel: '11:59' } }, 2)).toEqual({ text: '12:00', suffix: 'AM' });
    expect(clockFace({ loop: { startLabel: '11:59' } }, 3)).toEqual({ text: '12:01', suffix: 'AM' });
  });

  it('is null rather than a wrong time when there is no start', () => {
    expect(clockFace({}, 1)).toBeNull();
    expect(clockFace({ loop: { startLabel: 'soon' } }, 1)).toBeNull();
    expect(clockFace(null, 1)).toBeNull();
  });

  it('treats a missing or silly slot as the first', () => {
    expect(clockFace(ADVENTURE, 0).text).toBe('7:51');
    expect(clockFace(ADVENTURE, undefined).text).toBe('7:51');
  });
});
