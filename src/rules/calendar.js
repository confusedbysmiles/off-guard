/**
 * The Golarion calendar, as the Inner Sea region keeps it.
 *
 * GM Core page 146, "Time": a week has 7 days, a year has 52 weeks, and "an
 * extra leap day is tacked on to the second month of the year every 4 years".
 * Every four, not every eight -- the eight-year rule is older lore and is the
 * thing this would have got wrong from memory.
 *
 * The same page names each month beside its Earth equivalent -- Abadius
 * (January) through Kuthona (December) -- and each day beside its own:
 * Moonday (Monday) through Sunday. So the shape of the year is the Gregorian
 * one, and what makes this a Golarion calendar is the names, the reckoning,
 * and a leap rule with no century exceptions.
 *
 * Dates are `{ year, month, day }` with month and day counting from 1, and are
 * stored as `4725-09-14`: sortable as text, legible in a database, and never
 * mistakable for an ISO timestamp because the year is four digits of Absalom
 * Reckoning rather than of the common era.
 */

/** GM Core 146. `days` is the ordinary length; Calistril gains one in a leap year. */
export const MONTHS = [
  { number: 1, name: 'Abadius', days: 31, earth: 'January' },
  { number: 2, name: 'Calistril', days: 28, earth: 'February' },
  { number: 3, name: 'Pharast', days: 31, earth: 'March' },
  { number: 4, name: 'Gozran', days: 30, earth: 'April' },
  { number: 5, name: 'Desnus', days: 31, earth: 'May' },
  { number: 6, name: 'Sarenith', days: 30, earth: 'June' },
  { number: 7, name: 'Erastus', days: 31, earth: 'July' },
  { number: 8, name: 'Arodus', days: 31, earth: 'August' },
  { number: 9, name: 'Rova', days: 30, earth: 'September' },
  { number: 10, name: 'Lamashan', days: 31, earth: 'October' },
  { number: 11, name: 'Neth', days: 30, earth: 'November' },
  { number: 12, name: 'Kuthona', days: 31, earth: 'December' },
];

/** GM Core 146, in order, so index 0 is the first day of a week. */
export const WEEKDAYS = [
  { name: 'Moonday', short: 'Mo', earth: 'Monday' },
  { name: 'Toilday', short: 'To', earth: 'Tuesday' },
  { name: 'Wealday', short: 'We', earth: 'Wednesday' },
  { name: 'Oathday', short: 'Oa', earth: 'Thursday' },
  { name: 'Fireday', short: 'Fi', earth: 'Friday' },
  { name: 'Starday', short: 'St', earth: 'Saturday' },
  { name: 'Sunday', short: 'Su', earth: 'Sunday' },
];

/**
 * Which weekday the calendar is pinned to, and why it is a choice.
 *
 * No book in this library states the weekday of any given date, so the
 * alignment cannot be cited the way everything above can. This takes the
 * convention the rest of the hobby uses -- Absalom Reckoning runs 2,700 years
 * ahead of the common era, so 1 Abadius 4725 is 1 January 2025, which was a
 * Wednesday, which is Wealday.
 *
 * One constant, because it is the only thing here that could need changing: a
 * table that keeps a different alignment moves this and nothing else.
 */
export const ANCHOR = { year: 4725, month: 1, day: 1, weekday: 2 };

/** "an extra leap day... every 4 years". No century exception; the book states none. */
export const isLeapYear = (year) => Number(year) % 4 === 0;

export function daysInMonth(month, year) {
  const record = MONTHS[Number(month) - 1];
  if (!record) return 0;
  return record.days + (record.number === 2 && isLeapYear(year) ? 1 : 0);
}

export const daysInYear = (year) => (isLeapYear(year) ? 366 : 365);

/** Whether a date is one the calendar actually has. Month 13 and Rova 31 are not. */
export function isValid(date) {
  const year = Number(date?.year);
  const month = Number(date?.month);
  const day = Number(date?.day);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1 || year > 99999) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(month, year);
}

/** `4725-09-14`. Zero-padded so text order is date order. */
export function toKey(date) {
  if (!isValid(date)) return null;
  const pad = (n, width) => String(n).padStart(width, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

/** The other way. Anything that is not a date comes back null rather than NaN. */
export function fromKey(key) {
  const match = /^(\d{1,5})-(\d{2})-(\d{2})$/.exec(String(key ?? '').trim());
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return isValid(date) ? date : null;
}

/** Days from the start of year 1 to this date, for arithmetic and comparison. */
export function toDayNumber(date) {
  if (!isValid(date)) return null;
  // Leap years before this one: every fourth, counting year 4 as the first.
  const fullYears = date.year - 1;
  let days = fullYears * 365 + Math.floor(fullYears / 4);
  for (let month = 1; month < date.month; month += 1) days += daysInMonth(month, date.year);
  return days + date.day;
}

export function fromDayNumber(number) {
  let left = Math.trunc(Number(number));
  if (!Number.isFinite(left) || left < 1) return null;

  // Walk years rather than solving for one: a year is at most 366 days, the
  // loop is a few thousand steps for a date a table would ever use, and the
  // alternative is an inverse of the leap rule that is wrong at the edges.
  let year = 1;
  for (;;) {
    const length = daysInYear(year);
    if (left <= length) break;
    left -= length;
    year += 1;
  }

  let month = 1;
  for (;;) {
    const length = daysInMonth(month, year);
    if (left <= length) break;
    left -= length;
    month += 1;
  }

  return { year, month, day: left };
}

/** The weekday index, 0 for Moonday. */
export function weekdayOf(date) {
  const day = toDayNumber(date);
  const anchor = toDayNumber(ANCHOR);
  if (day === null || anchor === null) return null;
  return (((day - anchor + ANCHOR.weekday) % 7) + 7) % 7;
}

export const weekdayName = (date) => WEEKDAYS[weekdayOf(date)]?.name ?? null;
export const monthName = (month) => MONTHS[Number(month) - 1]?.name ?? null;

/** `14 Rova, 4725 AR`, which is how the books write one. */
export function format(date, { weekday = false, year = true } = {}) {
  if (!isValid(date)) return '';
  const printed = `${date.day} ${monthName(date.month)}`;
  const withYear = year ? `${printed}, ${date.year} AR` : printed;
  return weekday ? `${weekdayName(date)}, ${withYear}` : withYear;
}

export function addDays(date, count) {
  const day = toDayNumber(date);
  if (day === null) return null;
  return fromDayNumber(day + Math.trunc(Number(count) || 0));
}

/** Negative when `a` is earlier, so it sorts. */
export function compare(a, b) {
  const left = toDayNumber(a);
  const right = toDayNumber(b);
  if (left === null || right === null) return 0;
  return left - right;
}

/**
 * A month laid out as the weeks a calendar draws.
 *
 * Six rows of seven at most, each cell either a day of this month or null for
 * the days either side of it. The view does no date arithmetic of its own --
 * that is the whole point of handing it this.
 */
export function monthGrid(year, month) {
  const length = daysInMonth(month, year);
  if (!length) return [];
  const offset = weekdayOf({ year, month, day: 1 }) ?? 0;

  const cells = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length }, (unused, index) => index + 1),
  ];
  while (cells.length % 7) cells.push(null);

  const weeks = [];
  for (let at = 0; at < cells.length; at += 7) weeks.push(cells.slice(at, at + 7));
  return weeks;
}
