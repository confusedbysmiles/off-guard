/**
 * The dice roller.
 *
 * The roll itself happens on the server. That is not ceremony: a roll the table
 * can see has to reach the shared screen, and the only way for the GM's screen
 * and the television to agree is for one process to roll once.
 *
 * The expression is parsed here as well, but only to tell the GM their typo
 * before they press the button. The parser is the rules engine's, so the answer
 * is the same one the server will give.
 */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { DiceError, parseDice } from '../../../../engine/rules/dice.js';

/** The buttons a table actually reaches for. */
const QUICK = ['1d20', '1d4', '1d6', '1d8', '1d10', '1d12', '2d6', '1d100'];

function validate(expression) {
  if (!String(expression ?? '').trim()) return null;
  try {
    parseDice(expression);
    return null;
  } catch (error) {
    return error instanceof DiceError ? error.message : 'Cannot read that';
  }
}

/** `18 (7, 8) + 3`, so the log shows what was on the table. */
function breakdown(detail) {
  if (!detail?.terms) return '';
  return detail.terms.map((term, i) => {
    const sign = term.sign < 0 ? '-' : (i === 0 ? '' : '+');
    if (term.kind === 'flat') return `${sign}${term.value}`;
    const dice = term.rolls
      .map((r) => (r.counted ? String(r.value) : `(${r.value})`))
      .join(', ');
    return `${sign}${term.count}d${term.faces}[${dice}]`;
  }).join(' ');
}

function rollRow(roll, { onDerive }) {
  const derived = Boolean(roll.derivation);
  return el('li', {
    class: `roll${roll.secret ? ' roll--secret' : ''}${derived ? ' roll--derived' : ''}`,
  },
  el('div', { class: 'roll__total tabular' }, String(roll.total)),
  el('div', { class: 'roll__what' },
    el('strong', {}, roll.label || roll.expression),
    el('span', { class: 'faint' },
      derived
        ? `${roll.derivation === 'half' ? 'Halved' : 'Doubled'} from ${roll.detail.from}`
        : breakdown(roll.detail)),
    roll.detail?.natural === 20 ? el('span', { class: 'pill pill--good' }, 'Natural 20') : null,
    roll.detail?.natural === 1 ? el('span', { class: 'pill pill--bad' }, 'Natural 1') : null),
  el('div', { class: 'roll__tools' },
    roll.secret
      ? el('span', { class: 'pill pill--warn', title: 'Not shown on the shared screen' }, 'Secret')
      : null,
    derived ? null : el('button', {
      class: 'btn btn--quiet', type: 'button',
      title: 'Halve the total, rounding down',
      onclick: () => onDerive(roll.id, 'half'),
    }, 'Half'),
    derived ? null : el('button', {
      class: 'btn btn--quiet', type: 'button',
      title: 'Double the total, for a critical hit',
      onclick: () => onDerive(roll.id, 'double'),
    }, 'Double')));
}

/**
 * The dice tab.
 *
 * @param {object} options
 * @param {object[]} options.rolls  newest first
 * @param {object} options.ui       `{ expression, label, secret }`
 */
export function diceTab({ rolls, ui, onChange, onRoll, onDerive, onClear }) {
  const error = validate(ui.expression);

  const submit = () => {
    if (error || !ui.expression.trim()) return;
    onRoll({ expression: ui.expression, label: ui.label, secret: ui.secret });
  };

  const expression = el('input', {
    class: 'input', id: 'dice-expression', type: 'text', inputmode: 'text',
    placeholder: '2d6+3', value: ui.expression, autocomplete: 'off',
    'aria-describedby': error ? 'dice-error' : null,
    'aria-invalid': error ? 'true' : null,
    oninput: (event) => onChange({ expression: event.target.value }),
    onkeydown: (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submit();
    },
  });

  return el('div', { class: 'dice' },
    el('div', { class: 'dice__quick' }, ...QUICK.map((die) => el('button', {
      class: 'btn btn--quiet', type: 'button',
      onclick: () => onRoll({ expression: die, label: ui.label, secret: ui.secret }),
    }, die))),

    el('div', { class: 'dice__form' },
      el('div', { class: 'field' },
        el('label', { class: 'field__label', for: 'dice-expression' }, 'Expression'),
        expression),
      el('div', { class: 'field' },
        el('label', { class: 'field__label', for: 'dice-label' }, 'For'),
        el('input', {
          class: 'input', id: 'dice-label', type: 'text', placeholder: 'Goblin A, jaws',
          value: ui.label, autocomplete: 'off',
          oninput: (event) => onChange({ label: event.target.value }),
          onkeydown: (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            submit();
          },
        }))),

    error ? el('p', { class: 'field-error', id: 'dice-error', role: 'alert' }, error) : null,

    el('div', { class: 'dice__actions' },
      el('label', { class: 'checkbox-row' },
        el('input', {
          type: 'checkbox', checked: ui.secret,
          onchange: (event) => onChange({ secret: event.target.checked }),
        }),
        el('span', {}, 'Secret'),
        el('span', { class: 'faint' }, 'not shown on the shared screen')),
      el('button', {
        class: 'btn btn--primary', type: 'button', disabled: Boolean(error),
        html: `${icon('dice')}<span>Roll</span>`,
        onclick: submit,
      })),

    el('div', { class: 'dice__log-head' },
      el('h3', {}, 'Log'),
      rolls.length
        ? el('button', {
          class: 'btn btn--quiet', type: 'button',
          html: `${icon('x')}<span>Clear</span>`,
          onclick: onClear,
        })
        : null),

    rolls.length
      ? el('ol', { class: 'rolls' }, ...rolls.map((roll) => rollRow(roll, { onDerive })))
      : el('p', { class: 'faint' }, 'Nothing rolled yet in this campaign.'));
}
