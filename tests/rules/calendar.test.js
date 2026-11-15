/**
 * The Golarion calendar.
 *
 * Everything structural is cited to GM Core page 146. The one thing that is
 * not is the weekday alignment, which no book here states -- so it is pinned
 * to a constant and tested for self-consistency rather than against a source.
 */
import { describe, expect, it } from 'vitest';

import {
  MONTHS, WEEKDAYS, addDays, compare, daysInMonth, daysInYear, format, fromDayNumber,
  fromKey, isLeapYear, isValid, monthGrid, toDayNumber, toKey, weekdayName,
} from '../../src/rules/calendar.js';

describe('the shape of the year', () => {
  it('has the twelve months the book names, in order', () => {
    expect(MONTHS.map((m) => m.name)).toEqual([
      'Abadius', 'Calistril', 'Pharast', 'Gozran', 'Desnus', 'Sarenith',
      'Erastus', 'Arodus', 'Rova', 'Lamashan', 'Neth', 'Kuthona',
    ]);
  });

  it('has the seven days the book names, starting on Moonday', () => {
    expect(WEEKDAYS.map((d) => d.name)).toEqual([
      'Moonday', 'Toilday', 'Wealday', 'Oathday', 'Fireday', 'Starday', 'Sunday',
    ]);
  });

  it('runs to 365 days, and 366 in a leap year', () => {
    expect(MONTHS.reduce((sum, m) => sum + m.days, 0)).toBe(365);
    expect(daysInYear(4725)).toBe(365);
    expect(daysInYear(4724)).toBe(366);
  });

  /**
   * "an extra leap day is tacked on to the second month of the year every 4
   * years" -- GM Core 146. Every four. The eight-year rule is older lore, and
   * is what this would have been written as from memory.
   */
  it('adds the leap day to Calistril every fourth year, with no century exception', () => {
    expect(isLeapYear(4724)).toBe(true);
    expect(isLeapYear(4725)).toBe(false);
    // 4800 is divisible by 100 and still a leap year here: the book states no
    // exception, and inventing the Gregorian one would be inventing lore.
    expect(isLeapYear(4800)).toBe(true);
    expect(daysInMonth(2, 4724)).toBe(29);
    expect(daysInMonth(2, 4725)).toBe(28);
    expect(daysInMonth(9, 4724)).toBe(30);
  });
});

describe('a date', () => {
  it('refuses one the calendar does not have', () => {
    expect(isValid({ year: 4725, month: 9, day: 30 })).toBe(true);
    expect(isValid({ year: 4725, month: 9, day: 31 })).toBe(false);   // Rova has 30
    expect(isValid({ year: 4725, month: 2, day: 29 })).toBe(false);   // not a leap year
    expect(isValid({ year: 4724, month: 2, day: 29 })).toBe(true);
    expect(isValid({ year: 4725, month: 13, day: 1 })).toBe(false);
    expect(isValid({ year: 4725, month: 9, day: 0 })).toBe(false);
    expect(isValid(null)).toBe(false);
  });

  it('writes and reads a key that sorts as a date', () => {
    expect(toKey({ year: 4725, month: 9, day: 14 })).toBe('4725-09-14');
    expect(fromKey('4725-09-14')).toEqual({ year: 4725, month: 9, day: 14 });
    expect(['4725-10-01', '4725-09-14', '4724-12-31'].sort())
      .toEqual(['4724-12-31', '4725-09-14', '4725-10-01']);
  });

  it('reads nothing out of something that is not a date', () => {
    for (const bad of ['', 'yesterday', '4725-13-01', '4725-09-31', '2025-09-14T00:00:00Z', null]) {
      expect(fromKey(bad), String(bad)).toBe(null);
    }
  });

  it('prints the way the books print one', () => {
    expect(format({ year: 4725, month: 9, day: 14 })).toBe('14 Rova, 4725 AR');
    expect(format({ year: 4725, month: 9, day: 14 }, { year: false })).toBe('14 Rova');
    expect(format({ year: 4725, month: 9, day: 14 }, { weekday: true }))
      .toMatch(/^(Moonday|Toilday|Wealday|Oathday|Fireday|Starday|Sunday), 14 Rova, 4725 AR$/);
    expect(format(null)).toBe('');
  });
});

describe('counting days', () => {
  it('goes to a number and back again, across a leap day', () => {
    for (const date of [
      { year: 4725, month: 1, day: 1 },
      { year: 4724, month: 2, day: 29 },
      { year: 4724, month: 3, day: 1 },
      { year: 4725, month: 12, day: 31 },
      { year: 1, month: 1, day: 1 },
    ]) {
      expect(fromDayNumber(toDayNumber(date)), toKey(date)).toEqual(date);
    }
  });

  it('counts a whole year as a year', () => {
    const start = { year: 4725, month: 1, day: 1 };
    expect(toDayNumber({ year: 4726, month: 1, day: 1 }) - toDayNumber(start)).toBe(365);
    // 4724 is the leap year, so the year that contains it is a day longer.
    expect(toDayNumber({ year: 4725, month: 1, day: 1 })
      - toDayNumber({ year: 4724, month: 1, day: 1 })).toBe(366);
  });

  it('adds days across a month, a year and a leap day', () => {
    expect(addDays({ year: 4725, month: 9, day: 28 }, 5)).toEqual({ year: 4725, month: 10, day: 3 });
    expect(addDays({ year: 4725, month: 12, day: 31 }, 1)).toEqual({ year: 4726, month: 1, day: 1 });
    expect(addDays({ year: 4724, month: 2, day: 28 }, 1)).toEqual({ year: 4724, month: 2, day: 29 });
    expect(addDays({ year: 4725, month: 2, day: 28 }, 1)).toEqual({ year: 4725, month: 3, day: 1 });
    expect(addDays({ year: 4725, month: 3, day: 1 }, -1)).toEqual({ year: 4725, month: 2, day: 28 });
  });

  it('sorts', () => {
    expect(compare({ year: 4725, month: 1, day: 1 }, { year: 4725, month: 1, day: 2 }))
      .toBeLessThan(0);
    expect(compare({ year: 4725, month: 1, day: 2 }, { year: 4725, month: 1, day: 1 }))
      .toBeGreaterThan(0);
    expect(compare({ year: 4725, month: 1, day: 1 }, { year: 4725, month: 1, day: 1 })).toBe(0);
  });
});

describe('weekdays', () => {
  it('runs through the week one day at a time and comes back round', () => {
    let date = { year: 4725, month: 9, day: 1 };
    const seen = [];
    for (let i = 0; i < 8; i += 1) {
      seen.push(weekdayName(date));
      date = addDays(date, 1);
    }
    expect(seen.slice(0, 7).sort()).toEqual(WEEKDAYS.map((d) => d.name).sort());
    // The eighth day is the same weekday as the first.
    expect(seen[7]).toBe(seen[0]);
  });

  it('keeps step across the leap day', () => {
    // 28 Calistril 4724 is followed by a 29th, so 1 Pharast lands one weekday
    // later than it would in an ordinary year.
    const leap = weekdayName({ year: 4724, month: 3, day: 1 });
    const ordinary = weekdayName({ year: 4724, month: 2, day: 28 });
    expect(WEEKDAYS.findIndex((d) => d.name === leap))
      .toBe((WEEKDAYS.findIndex((d) => d.name === ordinary) + 2) % 7);
  });

  it('holds the anchor the alignment is pinned to', () => {
    // Not from a book -- see the note on ANCHOR. Stated here so that moving
    // it is a deliberate act with a failing test attached.
    expect(weekdayName({ year: 4725, month: 1, day: 1 })).toBe('Wealday');
  });
});

describe('a month as a calendar draws it', () => {
  it('pads to whole weeks and leaves the days either side empty', () => {
    const weeks = monthGrid(4725, 9);          // Rova, 30 days
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toEqual(
      Array.from({ length: 30 }, (unused, i) => i + 1),
    );
    // The first day sits under its own weekday.
    const first = weeks.flat().indexOf(1);
    expect(WEEKDAYS[first % 7].name).toBe(weekdayName({ year: 4725, month: 9, day: 1 }));
  });

  it('gives Calistril a 29th cell in a leap year and not otherwise', () => {
    expect(monthGrid(4724, 2).flat().filter(Boolean)).toHaveLength(29);
    expect(monthGrid(4725, 2).flat().filter(Boolean)).toHaveLength(28);
  });

  it('has nothing to draw for a month that does not exist', () => {
    expect(monthGrid(4725, 13)).toEqual([]);
  });
});
