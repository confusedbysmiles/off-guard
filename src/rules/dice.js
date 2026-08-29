/**
 * Dice.
 *
 * A parser and evaluator for the expressions a Pathfinder table actually types:
 * `2d6+3`, `1d20+9`, `4d8+2d6+5`, and the fortune/misfortune form `2d20kh1`.
 * Nothing more elaborate -- no exploding dice, no reroll syntax, no arithmetic
 * beyond addition and subtraction of terms -- because every one of those would
 * be a rule this application had invented.
 *
 * Randomness is injected. The engine never reaches for a global source, so the
 * server can roll from `crypto` and a test can roll from a fixed sequence, and
 * both take exactly the same path through the parser.
 *
 * Halving and doubling live here rather than in the interface because they are
 * rules: a basic save success halves the damage and rounds down, and a critical
 * hit doubles it (Player Core, Doubling and Halving Damage). Both apply to the
 * *total*, after everything is added up, which is what that section says.
 */

/** Dice a fair table rolls. A typo like `1d7` is a mistake worth reporting. */
export const DIE_FACES = [2, 3, 4, 6, 8, 10, 12, 20, 100];

/** Ceilings, so a slip of the keyboard cannot hang the tab it was typed into. */
export const LIMITS = { count: 100, terms: 20 };

export class DiceError extends Error {}

const TERM = /^([+-]?)(?:(\d*)d(\d+)(?:k([hl])(\d+))?|(\d+))$/i;

/**
 * Split an expression into signed terms.
 * `2d6 + 3 - 1d4` -> three terms; whitespace anywhere is ignored.
 */
function tokenize(text) {
  const cleaned = String(text ?? '').replace(/\s+/g, '');
  if (!cleaned) throw new DiceError('Nothing to roll');
  // Keep the sign attached to the term that follows it.
  const pieces = cleaned.replace(/([+-])/g, ' $1').split(' ').filter(Boolean);
  if (pieces.length > LIMITS.terms) throw new DiceError(`More than ${LIMITS.terms} terms`);
  return pieces;
}

/**
 * Parse an expression into terms without rolling anything.
 * Returns `{ text, terms }`; every term carries its sign as +1 or -1.
 */
export function parseDice(text) {
  const terms = tokenize(text).map((piece) => {
    const match = TERM.exec(piece);
    if (!match) throw new DiceError(`Cannot read "${piece}"`);
    const [, sign, rawCount, rawFaces, keepMode, rawKeep, flat] = match;
    const signum = sign === '-' ? -1 : 1;

    if (flat !== undefined) {
      return { kind: 'flat', sign: signum, value: Number(flat) };
    }

    const count = rawCount === '' ? 1 : Number(rawCount);
    const faces = Number(rawFaces);
    if (count < 1) throw new DiceError('A die has to be rolled at least once');
    if (count > LIMITS.count) throw new DiceError(`More than ${LIMITS.count} dice`);
    if (!DIE_FACES.includes(faces)) {
      throw new DiceError(
        `d${faces} is not a die this table has (${DIE_FACES.map((f) => `d${f}`).join(', ')})`,
      );
    }

    let keep = null;
    if (keepMode) {
      const n = Number(rawKeep);
      if (n < 1 || n > count) throw new DiceError(`Cannot keep ${n} of ${count} dice`);
      keep = { mode: keepMode.toLowerCase() === 'h' ? 'highest' : 'lowest', count: n };
    }

    return { kind: 'dice', sign: signum, count, faces, keep };
  });

  return { text: format(terms), terms };
}

/** Render parsed terms back to a canonical string: `2d6+3`, `1d20-1`. */
export function format(terms) {
  return terms.map((term, i) => {
    const sign = term.sign < 0 ? '-' : (i === 0 ? '' : '+');
    if (term.kind === 'flat') return `${sign}${term.value}`;
    const keep = term.keep ? `k${term.keep.mode === 'highest' ? 'h' : 'l'}${term.keep.count}` : '';
    return `${sign}${term.count}d${term.faces}${keep}`;
  }).join('');
}

function defaultRandom() {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] / 2 ** 32;
}

/**
 * Roll an expression.
 *
 * The result keeps every individual die, including the ones a `kh`/`kl` term
 * discarded, so the log can show what was on the table rather than a total the
 * players have to take on trust.
 */
export function rollDice(text, { random = defaultRandom } = {}) {
  const parsed = parseDice(text);
  let total = 0;

  const terms = parsed.terms.map((term) => {
    if (term.kind === 'flat') {
      total += term.sign * term.value;
      return { ...term, subtotal: term.sign * term.value };
    }

    const rolls = Array.from({ length: term.count }, (unused, index) => ({
      value: 1 + Math.floor(random() * term.faces),
      index,
      counted: true,
    }));

    if (term.keep) {
      const order = [...rolls].sort((a, b) => (term.keep.mode === 'highest'
        ? b.value - a.value
        : a.value - b.value));
      const keeping = new Set(order.slice(0, term.keep.count).map((r) => r.index));
      for (const roll of rolls) roll.counted = keeping.has(roll.index);
    }

    const sum = rolls.filter((r) => r.counted).reduce((acc, r) => acc + r.value, 0);
    total += term.sign * sum;
    return { ...term, rolls, subtotal: term.sign * sum };
  });

  return { expression: parsed.text, terms, total, natural: naturalOf(terms) };
}

/**
 * The number on the die, for a check.
 *
 * Only meaningful when the expression rolls exactly one d20 -- that is the roll
 * whose natural 1 and natural 20 change the degree of success (Player Core,
 * Checks). Anything else returns null rather than guessing which die mattered.
 */
function naturalOf(terms) {
  const dice = terms.filter((t) => t.kind === 'dice');
  if (dice.length !== 1) return null;
  const [term] = dice;
  if (term.faces !== 20 || term.sign < 0) return null;
  const counted = term.rolls.filter((r) => r.counted);
  return counted.length === 1 ? counted[0].value : null;
}

/**
 * Halve a total, rounding down. Player Core, Doubling and Halving Damage.
 * A halved total does not go below zero.
 */
export function halve(total) {
  return Math.max(0, Math.floor(Number(total) / 2));
}

/** Double a total. The same section: double the total, not each die. */
export function double(total) {
  return Number(total) * 2;
}
