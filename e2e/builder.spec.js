/**
 * The builder's own fields, in a browser.
 *
 * Two things that were wrong in ways only a real keyboard shows.
 *
 * `lores` is a derived path, so the sheet's own Lore fields lock the moment a
 * character is built -- and the builder had no Lore field of its own. The
 * result was a dead end: a character could read the Lore their background gave
 * them and could not add the one they picked up in play.
 *
 * This is the regression test, and it has to run in a browser: the failure was
 * the join between two screens, and each of them looked right on its own.
 */
import { expect, test } from '@playwright/test';

import { sandbox } from './sandbox.js';
import { loadWorld, PORTS } from './world.js';

const world = loadWorld(PORTS.desktop);
const table = sandbox(world.gmToken, 'the builder spec');

let playerToken;

test.beforeAll(async ({ request }) => { ({ playerToken } = await table.create(request)); });
test.afterAll(async ({ request }) => { await table.archive(request); });

/**
 * Wait for what was typed to reach the server.
 *
 * The builder debounces a text field by 400ms and then debounces the save
 * again, so a reload straight after typing races the application rather than
 * testing it. Asked of the server rather than of the save indicator: on
 * localhost the indicator goes from "Saved" back to "Saved" faster than a poll
 * can see, so watching it proves nothing either way.
 */
async function savedLores(page) {
  return page.evaluate(async () => {
    const res = await fetch(`${location.pathname.replace('/build/', '/api/c/')}/builder`, {
      headers: { accept: 'application/json' },
    });
    return (await res.json()).build?.skills?.lores ?? [];
  });
}

test('a built character can add a Lore, and it reaches the sheet', async ({ page }) => {
  await page.goto(`/build/${playerToken}`);

  const slot = page.locator('.slot-row', { hasText: 'Lore skills' });
  await expect(slot).toBeVisible();

  await slot.getByRole('button', { name: 'Add a Lore' }).click();
  await slot.getByLabel('Lore 1', { exact: true }).fill('Underworld Lore');
  await slot.getByLabel('Rank of Lore 1').selectOption('expert');

  await expect.poll(() => savedLores(page), { timeout: 10_000 })
    .toEqual([{ name: 'Underworld Lore', rank: 'expert' }]);

  await page.reload();
  await expect(slot.getByLabel('Lore 1', { exact: true })).toHaveValue('Underworld Lore');
  await expect(slot.getByLabel('Rank of Lore 1')).toHaveValue('expert');

  // And on the sheet, where it is read-only because the builder owns it --
  // which is the half of this that was working all along.
  await page.goto(`/c/${playerToken}`);
  const field = page.getByLabel('Lore 1 name');
  await expect(field).toHaveValue('Underworld Lore');
  await expect(field).toHaveAttribute('readonly', '');
});

test('the Lore a background grants is shown but not editable in the builder', async ({ page }) => {
  await page.goto(`/build/${playerToken}`);

  await page.getByRole('button', { name: /^Background/ }).click();
  const picker = page.locator('.picker');
  await picker.locator('#picker-search').fill('Acolyte');
  await picker.locator('.picker__row', { hasText: 'Acolyte' }).first()
    .locator('.picker__choose').click();
  await expect(picker).toBeHidden();

  // Scribing Lore comes from the background, so it is stated rather than
  // offered: editing it here would mean editing the background, and removing
  // it would mean the next render putting it straight back.
  const slot = page.locator('.slot-row', { hasText: 'Lore skills' });
  await expect(slot.locator('.lores__granted')).toContainText('Scribing Lore');
  await expect(slot.locator('.lores__granted')).toContainText('from your background');
  // The one the player typed is still theirs.
  await expect(slot.getByLabel('Lore 1', { exact: true })).toHaveValue('Underworld Lore');
});

/**
 * Money.
 *
 * The coin fields were pre-filled with a literal 0, so clicking into Gold and
 * typing 25 left "025" -- and nothing corrected it, because changing a coin
 * does not re-render that section. The value parsed to the right number, which
 * is why it survived: it was only ever wrong on screen, which is the only place
 * anybody looks.
 */
test('an empty purse is an empty box, and typing into it is not prefixed', async ({ page, request }) => {
  const { token } = await table.addCharacter(request, 'Moneybags');
  await page.goto(`/build/${token}`);

  const gold = page.locator('#coins-gp');
  await expect(gold).toHaveValue('');
  await expect(gold).toHaveAttribute('placeholder', '0');

  await gold.click();
  await page.keyboard.type('25');
  await expect(gold).toHaveValue('25');

  await expect.poll(async () => page.evaluate(async () => {
    const res = await fetch(`${location.pathname.replace('/build/', '/api/c/')}/builder`, {
      headers: { accept: 'application/json' },
    });
    return (await res.json()).build?.coins?.gp ?? null;
  }), { timeout: 10_000 }).toBe(25);

  await expect(page.locator('.slot-row', { hasText: 'Coins' }).first()).toContainText('Worth 25 gp altogether');

  await page.reload();
  await expect(page.locator('#coins-gp')).toHaveValue('25');
  // The denominations nobody used stay empty rather than showing zeroes.
  await expect(page.locator('#coins-sp')).toHaveValue('');
});
