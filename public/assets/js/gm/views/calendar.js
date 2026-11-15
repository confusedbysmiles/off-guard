/**
 * The campaign calendar, from the GM's side.
 *
 * The month is the same component the player sees -- see `lib/calendar-view.js`
 * -- with the things only a GM may do hung underneath it: move the party's
 * date, mark a day, and decide whether the party is told.
 *
 * Shared is off by default on every new mark, which is the whole point of the
 * feature. The day the cult finishes its ritual belongs on this calendar weeks
 * before anybody at the table has business knowing it is there.
 */
import { format, fromKey, monthList, monthView, openingMonth, toKey }
  from '../../lib/calendar-view.js';
import { MONTHS } from '../../../../engine/rules/calendar.js';
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';

const dayOptions = (year, month) => {
  const record = MONTHS[month - 1];
  const days = record.days + (record.number === 2 && year % 4 === 0 ? 1 : 0);
  return Array.from({ length: days }, (unused, i) => i + 1);
};

/** A date, as three fields rather than a text box nobody can spell. */
function dateFields(value, { label }) {
  const start = fromKey(value) ?? { year: 4725, month: 1, day: 1 };

  const year = el('input', {
    class: 'input input--number', type: 'number', inputmode: 'numeric',
    'aria-label': `${label}: year`, value: String(start.year), min: '1', max: '99999',
  });
  const month = el('select', { class: 'rank-select', 'aria-label': `${label}: month` },
    ...MONTHS.map((m) => el('option', {
      value: String(m.number), selected: m.number === start.month,
    }, m.name)));
  const day = el('select', { class: 'rank-select', 'aria-label': `${label}: day` });

  const fillDays = () => {
    const wanted = Number(day.value) || start.day;
    const options = dayOptions(Number(year.value) || start.year, Number(month.value));
    day.replaceChildren(...options.map((d) => el('option', {
      value: String(d), selected: d === Math.min(wanted, options.length),
    }, String(d))));
  };
  fillDays();
  month.addEventListener('change', fillDays);
  year.addEventListener('change', fillDays);

  return {
    node: el('div', { class: 'cal__fields' }, day, month, year),
    read: () => toKey({
      year: Number(year.value), month: Number(month.value), day: Number(day.value),
    }),
    set: (key) => {
      const next = fromKey(key);
      if (!next) return;
      year.value = String(next.year);
      month.value = String(next.month);
      fillDays();
      day.value = String(next.day);
    },
  };
}

export function calendarPanel({ calendar, view, actions }) {
  const { date = null, events = [] } = calendar ?? {};
  const at = view?.year && view?.month ? view : openingMonth(calendar ?? {});
  const selected = view?.selected ?? date ?? null;

  const move = (next) => actions.viewCalendar({ ...next, selected });

  const marked = dateFields(selected, { label: 'The day to mark' });
  const ends = dateFields(selected, { label: 'The day it ends' });
  const title = el('input', {
    class: 'input', type: 'text', placeholder: 'The Ulfen envoy arrives', required: true,
    'aria-label': 'What happens',
  });
  const body = el('textarea', {
    class: 'textarea', rows: 2, 'aria-label': 'Anything else about it',
    placeholder: 'Anything else about it',
  });
  const shared = el('input', { type: 'checkbox', 'aria-label': 'The party can see this' });
  const spans = el('input', { type: 'checkbox', 'aria-label': 'It runs over several days' });

  ends.node.hidden = true;
  spans.addEventListener('change', () => { ends.node.hidden = !spans.checked; });

  const form = el('form', { class: 'stack-md' },
    el('div', { class: 'field' },
      el('span', { class: 'field__label' }, 'On'),
      marked.node),
    el('label', { class: 'check' }, spans, el('span', {}, 'It runs over several days')),
    el('div', { class: 'field', hidden: false },
      el('span', { class: 'field__label' }, 'Until'),
      ends.node),
    el('div', { class: 'field' }, el('span', { class: 'field__label' }, 'What happens'), title),
    body,
    el('label', { class: 'check' }, shared,
      el('span', {}, 'The party can see this')),
    el('button', { class: 'btn btn--primary', type: 'submit' },
      `${icon('plus')}`, el('span', {}, 'Mark it')));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const ok = await actions.markDay({
      at: marked.read(),
      endsAt: spans.checked ? ends.read() : null,
      title: title.value.trim(),
      body: body.value.trim(),
      shared: shared.checked,
    });
    if (ok) { title.value = ''; body.value = ''; }
  });

  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'Calendar'),
      el('span', { class: 'muted' },
        date ? format(fromKey(date), { weekday: true }) : 'no date set')),

    el('p', { class: 'muted' },
      'Golarion’s calendar, in Absalom Reckoning. The party sees this tab too, '
      + 'with the date and whatever you have shared — a mark is yours until '
      + 'you tick the box.'),

    monthView({
      year: at.year,
      month: at.month,
      date,
      events,
      onMove: move,
      onPickDay: (key) => actions.viewCalendar({ ...at, selected: key }),
      selected,
    }),

    el('div', { class: 'cal__tools row-inline row-inline--wrap' },
      el('button', {
        class: 'btn', type: 'button',
        disabled: !selected || selected === date,
        html: `${icon('check')}<span>Party is here</span>`,
        title: selected
          ? `Set ${format(fromKey(selected))} as where the party is`
          : 'Pick a day first',
        onclick: () => actions.setCampaignDate(selected),
      }),
      date
        ? el('button', {
          class: 'btn btn--quiet', type: 'button',
          html: `${icon('x')}<span>Clear the date</span>`,
          onclick: () => actions.setCampaignDate(null),
        })
        : null),

    monthList(at.year, at.month, events, {
      render: (event) => el('span', { class: 'row-inline' },
        el('button', {
          class: 'btn btn--quiet', type: 'button',
          title: event.shared ? 'Take it back from the party' : 'Let the party see it',
          html: `${icon(event.shared ? 'eye' : 'shield')}`
            + `<span class="sr-only">${event.shared ? 'Unshare' : 'Share'}</span>`,
          onclick: () => actions.shareEvent(event, !event.shared),
        }),
        el('button', {
          class: 'btn btn--icon btn--quiet', type: 'button',
          title: `Remove ${event.title || 'this mark'}`,
          html: `${icon('x')}<span class="sr-only">Remove</span>`,
          onclick: () => actions.unmarkDay(event),
        })),
    }),

    el('h3', { class: 'heading-spaced' },
      selected ? `Mark ${format(fromKey(selected), { year: false })}` : 'Mark a day'),
    form);
}
