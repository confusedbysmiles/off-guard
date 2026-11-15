/**
 * A month of the Golarion calendar, drawn.
 *
 * One component for both screens: the GM's tab and the player's see the same
 * month in the same shape, because they are looking at the same campaign and a
 * calendar that disagreed with itself across two screens would be worse than
 * no calendar. What differs is what each may do -- the GM passes handlers, the
 * player passes none and gets a month they can read and page through.
 *
 * All the date arithmetic is the engine's. This file decides nothing about
 * what a month contains; it asks `monthGrid` and draws the answer.
 */
import {
  MONTHS, WEEKDAYS, compare, format, fromKey, monthGrid, monthName, toKey,
} from '../../../engine/rules/calendar.js';
import { el } from './dom.js';
import { icon } from './icons.js';

/** Which days an event covers: one, or every day of its span. */
export function covers(event, key) {
  const at = String(event?.at ?? '');
  if (!at) return false;
  const ends = String(event?.endsAt ?? '') || at;
  return key >= at && key <= ends;
}

/** The events on one day, span events included. */
export const eventsOn = (events, key) => (events ?? []).filter((e) => covers(e, key));

/**
 * The month a calendar should open on.
 *
 * Where the party is, failing that the first thing marked, failing that the
 * first month of a year nobody has to have chosen -- which is only ever shown
 * to a GM who has not set a date, since a player with no calendar is told so
 * rather than shown an empty Abadius.
 */
export function openingMonth({ date, events } = {}) {
  const here = fromKey(date);
  if (here) return { year: here.year, month: here.month };
  const first = fromKey((events ?? [])[0]?.at);
  if (first) return { year: first.year, month: first.month };
  return { year: 4725, month: 1 };
}

export function monthView({
  year,
  month,
  date = null,
  events = [],
  onMove = null,
  onPickDay = null,
  selected = null,
}) {
  const today = fromKey(date);
  const isToday = (day) => Boolean(today)
    && today.year === year && today.month === month && today.day === day;

  const step = (by) => {
    const at = (year * 12 + (month - 1)) + by;
    return { year: Math.floor(at / 12), month: (at % 12) + 1 };
  };

  const head = el('div', { class: 'cal__head' },
    onMove
      ? el('button', {
        class: 'btn btn--icon btn--quiet', type: 'button',
        title: `${monthName(step(-1).month)} ${step(-1).year}`,
        html: `${icon('chevron')}<span class="sr-only">The month before</span>`,
        onclick: () => onMove(step(-1)),
      })
      : null,
    el('strong', { class: 'cal__title' }, `${monthName(month)} ${year} AR`),
    onMove
      ? el('button', {
        class: 'btn btn--icon btn--quiet cal__next', type: 'button',
        title: `${monthName(step(1).month)} ${step(1).year}`,
        html: `${icon('chevron')}<span class="sr-only">The month after</span>`,
        onclick: () => onMove(step(1)),
      })
      : null);

  const weekdays = el('div', { class: 'cal__weekdays' },
    ...WEEKDAYS.map((day) => el('abbr', { class: 'cal__weekday', title: day.name }, day.short)));

  const grid = el('div', { class: 'cal__grid' });
  for (const week of monthGrid(year, month)) {
    for (const day of week) {
      if (day === null) { grid.append(el('div', { class: 'cal__cell cal__cell--empty' })); continue; }

      const key = toKey({ year, month, day });
      const marks = eventsOn(events, key);
      const here = isToday(day);
      const classes = ['cal__cell'];
      if (here) classes.push('cal__cell--today');
      if (marks.length) classes.push('cal__cell--marked');
      if (selected === key) classes.push('cal__cell--selected');

      const label = [
        format({ year, month, day }, { weekday: true }),
        here ? 'where the party is' : null,
        ...marks.map((mark) => mark.title || 'an event'),
      ].filter(Boolean).join(' — ');

      const content = [
        el('span', { class: 'cal__day' }, String(day)),
        marks.length
          ? el('span', { class: 'cal__marks', 'aria-hidden': 'true' },
            ...marks.slice(0, 3).map((mark) => el('span', {
              class: `cal__mark${mark.shared === false ? ' cal__mark--private' : ''}`,
            })))
          : null,
      ];

      grid.append(onPickDay
        ? el('button', {
          class: classes.join(' '), type: 'button',
          'aria-pressed': String(selected === key),
          title: label,
          onclick: () => onPickDay(key),
        }, ...content)
        : el('div', { class: classes.join(' '), title: label }, ...content));
    }
  }

  return el('div', { class: 'cal' }, head, weekdays, grid);
}

/**
 * The month's events as a list under the grid.
 *
 * The grid says which days carry something; this says what. A calendar that
 * only put dots on days would make a GM click twelve of them to find the one
 * they meant.
 */
export function monthList(year, month, events, { render = null } = {}) {
  const inMonth = (events ?? []).filter((event) => {
    const at = fromKey(event.at);
    const ends = fromKey(event.endsAt) ?? at;
    if (!at) return false;
    // A span that starts in August and ends in October belongs to September too.
    return !(ends.year < year || (ends.year === year && ends.month < month))
      && !(at.year > year || (at.year === year && at.month > month));
  }).sort((a, b) => compare(fromKey(a.at), fromKey(b.at)));

  if (!inMonth.length) {
    return el('p', { class: 'faint cal__empty' }, `Nothing marked in ${monthName(month)}.`);
  }

  return el('ul', { class: 'cal__list' }, ...inMonth.map((event) => el('li', {
    class: `cal__entry${event.shared === false ? ' cal__entry--private' : ''}`,
  },
  el('span', { class: 'cal__when' },
    format(fromKey(event.at), { year: false })
      + (event.endsAt && event.endsAt !== event.at
        ? ` – ${format(fromKey(event.endsAt), { year: false })}`
        : '')),
  el('span', { class: 'cal__what' },
    el('strong', {}, event.title || 'Untitled'),
    event.body ? el('span', { class: 'faint' }, event.body) : null),
  render ? render(event) : null)));
}

export { MONTHS, format, fromKey, toKey };
