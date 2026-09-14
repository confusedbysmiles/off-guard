/**
 * Bulk, coins and encumbrance.
 *
 * The numbers are worked from Player Core: ten light items are one Bulk, a
 * thousand coins are one Bulk, worn armour counts one less than it does in the
 * shop, and a character is encumbered above 5 plus their Strength modifier.
 *
 * Mostly, though, this is here for the tenths. Upstream writes a light item as
 * `0.1`, and the reason the arithmetic is integers is that ten of them in
 * floating point come to 0.9999999999999999 -- which is under one Bulk, which
 * is a character who is not encumbered when they are.
 */
import { describe, expect, it } from 'vitest';

import {
  bulkText, coinBulk, coinCount, coinValue, encumbrance, priceText, tenthsOf, wornTenths,
} from '../../src/rules/character/bulk.js';

describe('tenths', () => {
  it('reads a printed Bulk', () => {
    expect(tenthsOf(1)).toBe(10);
    expect(tenthsOf(0.1)).toBe(1);
    expect(tenthsOf(0)).toBe(0);
    expect(tenthsOf(undefined)).toBe(0);
  });

  it('adds ten light items up to exactly one Bulk', () => {
    // The whole reason this module counts in tenths: `0.1 * 10` does not.
    const ten = Array.from({ length: 10 }, () => tenthsOf(0.1)).reduce((a, b) => a + b, 0);
    expect(ten).toBe(10);
    expect(bulkText(ten)).toBe('1 Bulk');
  });
});

describe('what it is called', () => {
  it('says nothing rather than zero', () => {
    expect(bulkText(0)).toBe('—');
  });

  it('counts light items in L until there are ten of them', () => {
    expect(bulkText(1)).toBe('L');
    expect(bulkText(4)).toBe('4 L');
    expect(bulkText(10)).toBe('1 Bulk');
    expect(bulkText(13)).toBe('1 Bulk, 3 L');
    expect(bulkText(52)).toBe('5 Bulk, 2 L');
  });
});

describe('money', () => {
  const purse = { pp: 1, gp: 43, sp: 12, cp: 5 };

  it('counts coins of every kind together', () => {
    expect(coinCount(purse)).toBe(61);
  });

  it('is worth what it is worth, in gold', () => {
    expect(coinValue(purse)).toBeCloseTo(10 + 43 + 1.2 + 0.05, 5);
  });

  it('weighs nothing until there are a thousand coins', () => {
    expect(coinBulk(purse)).toBe(0);
    expect(coinBulk({ gp: 999 })).toBe(9);
    expect(coinBulk({ gp: 1000 })).toBe(10);
    // Mixed denominations count as coins, not as value.
    expect(coinBulk({ pp: 500, cp: 500 })).toBe(10);
  });

  it('ignores a negative purse rather than crediting it', () => {
    expect(coinCount({ gp: -50 })).toBe(0);
    expect(coinValue({ gp: -50 })).toBe(0);
  });

  it('prints a price in the denominations it is printed in', () => {
    expect(priceText({ gp: 1 })).toBe('1 gp');
    expect(priceText({ gp: 4, sp: 5 })).toBe('4 gp, 5 sp');
    // An item with no price says nothing rather than claiming to be free.
    expect(priceText(null)).toBe('');
    expect(priceText({})).toBe('');
  });
});

describe('worn armour', () => {
  it('weighs one less than it does in the shop', () => {
    expect(wornTenths(tenthsOf(4))).toBe(30);
    expect(wornTenths(tenthsOf(1))).toBe(1);
  });

  it('never falls below L, however light it started', () => {
    expect(wornTenths(tenthsOf(0.1))).toBe(1);
    expect(wornTenths(0)).toBe(0);
  });
});

describe('encumbrance', () => {
  it('puts both thresholds where Strength puts them', () => {
    expect(encumbrance(0, 4)).toMatchObject({ encumberedAt: 9, maxAt: 14 });
    expect(encumbrance(0, -1)).toMatchObject({ encumberedAt: 4, maxAt: 9 });
  });

  it('is not encumbered at the threshold, only above it', () => {
    expect(encumbrance(50, 0).encumbered).toBe(false);
    expect(encumbrance(51, 0).encumbered).toBe(true);
    expect(encumbrance(100, 0).overloaded).toBe(false);
    expect(encumbrance(101, 0).overloaded).toBe(true);
  });

  it('reports rather than refuses', () => {
    // Carrying your friend's body out of the dungeon is a thing people do.
    const over = encumbrance(400, 0);
    expect(over.overloaded).toBe(true);
    expect(over.text).toBe('40 Bulk');
  });
});
