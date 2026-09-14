/**
 * Bulk, counted in tenths.
 *
 * Bulk is two units wearing one name: a whole Bulk, and "L" for light, ten of
 * which make one. Held as decimals -- upstream writes a light item as `0.1` --
 * ten torches come to `0.9999999999999999` and a character is encumbered by
 * rounding. So everything here is an integer number of tenths, converted once
 * on the way in and formatted once on the way out.
 *
 * Shared by the server's derivation and by both browser pages, because the
 * alternative is two implementations of the same arithmetic disagreeing about
 * whether somebody can walk.
 */

/** One L, in tenths. */
export const LIGHT = 1;

/** A printed Bulk (`1`, `0.1`, `0`) as tenths. */
export const tenthsOf = (bulk) => Math.round(Number(bulk ?? 0) * 10);

/** The coin denominations, in the order they are printed and counted. */
export const COINS = [
  ['pp', 'Platinum', 10],
  ['gp', 'Gold', 1],
  ['sp', 'Silver', 0.1],
  ['cp', 'Copper', 0.01],
];

/** How many coins, of all kinds, are in a purse. */
export const coinCount = (coins = {}) => COINS
  .reduce((total, [key]) => total + Math.max(0, Math.trunc(Number(coins?.[key] ?? 0))), 0);

/** What a purse is worth, in gold pieces. */
export const coinValue = (coins = {}) => COINS
  .reduce((total, [key, , worth]) => total + Math.max(0, Number(coins?.[key] ?? 0)) * worth, 0);

/**
 * The Bulk of money.
 *
 * A thousand coins of any mix are 1 Bulk, and fewer than that are nothing --
 * which is the rule as printed, and also the reason a purse never rounds a
 * character into being encumbered.
 */
export const coinBulk = (coins = {}) => Math.floor(coinCount(coins) / 100);

/**
 * Worn armour weighs one less than it does in the shop, to a minimum of L.
 * Printed on the armour itself, so it applies to the suit being worn and to
 * nothing else being carried.
 */
export const wornTenths = (tenths) => (tenths <= LIGHT ? tenths : Math.max(LIGHT, tenths - 10));

/** `13` -> `1 Bulk, 3 L`. Empty is "—", not "0 Bulk". */
export function bulkText(tenths) {
  const total = Math.max(0, Math.round(Number(tenths ?? 0)));
  if (!total) return '—';
  const whole = Math.floor(total / 10);
  const light = total % 10;
  const parts = [];
  if (whole) parts.push(`${whole} Bulk`);
  if (light) parts.push(light === 1 ? 'L' : `${light} L`);
  return parts.join(', ');
}

/**
 * Encumbrance.
 *
 * Encumbered above 5 plus Strength, and nothing may be carried above 10 plus
 * it. Reported, never enforced: a character who has just picked up the body of
 * their friend is over the limit on purpose, and a builder that refused to
 * record that would be wrong about the fiction as well as unhelpful.
 */
export function encumbrance(tenths, strMod = 0) {
  const str = Number(strMod ?? 0);
  const encumberedAt = 5 + str;
  const maxAt = 10 + str;
  const carried = Math.max(0, Math.round(Number(tenths ?? 0)));
  return {
    tenths: carried,
    text: bulkText(carried),
    encumberedAt,
    maxAt,
    encumbered: carried > encumberedAt * 10,
    overloaded: carried > maxAt * 10,
  };
}

/**
 * A printed price: `{ gp: 1, sp: 5 }` -> `1 gp, 5 sp`.
 * An item with no price at all -- an artifact, a quest object -- says nothing
 * rather than "0 gp", which would be a claim about it being worthless.
 */
export function priceText(price) {
  const parts = COINS
    .filter(([key]) => Number(price?.[key] ?? 0) > 0)
    .map(([key]) => `${Number(price[key])} ${key}`);
  return parts.join(', ');
}
