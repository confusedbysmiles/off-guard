/**
 * The calendar, across both screens.
 *
 * The load-bearing test is the last one: a mark the GM has not shared is not
 * on the player's tab, and sharing it puts it there. That is the only part of
 * this feature that could do harm if it were wrong.
 */
import { expect, test } from '@playwright/test';

import { sandbox } from './sandbox.js';
import { loadWorld, PORTS } from './world.js';

const world = loadWorld(PORTS.desktop);
const table = sandbox(world.gmToken, 'the calendar spec');

let playerToken;

test.beforeAll(async ({ request }) => { ({ playerToken } = await table.create(request)); });
test.afterAll(async ({ request }) => { await table.archive(request); });

const gmPage = (page) => page.goto(`/gm/${world.gmToken}#/campaign/${table.campaignId}/calendar`);

test('a campaign with no calendar has no calendar tab on the sheet', async ({ page }) => {
  await page.goto(`/c/${playerToken}`);
  await expect(page.locator('.sheet-tabs').getByRole('button', { name: 'Calendar' }))
    .toBeHidden();
});

test('the GM sets where the party is, and the player reads it', async ({ page, request }) => {
  await request.put(
    `/api/gm/${world.gmToken}/campaigns/${table.campaignId}/calendar/date`,
    { data: { date: '4725-09-14' } },
  );

  await gmPage(page);
  const month = page.locator('.cal');
  await expect(month.locator('.cal__title')).toHaveText('Rova 4725 AR');
  // 14 Rova 4725 is a Sunday, which is the last column.
  await expect(month.locator('.cal__cell--today')).toHaveText('14');

  await page.goto(`/c/${playerToken}`);
  await page.locator('.sheet-tabs').getByRole('button', { name: 'Calendar' }).click();
  await expect(page.locator('.cal__cell--today')).toHaveText('14');
  // Read-only: there is nothing on a player's month to press.
  await expect(page.locator('.cal__grid button')).toHaveCount(0);
});

test('the months run in Golarion’s order, and Calistril is short', async ({ page }) => {
  await gmPage(page);
  const title = page.locator('.cal__title');
  await expect(title).toHaveText('Rova 4725 AR');

  // Forward into the next year, which is the step most likely to be wrong.
  for (const expected of ['Lamashan 4725 AR', 'Neth 4725 AR', 'Kuthona 4725 AR', 'Abadius 4726 AR']) {
    await page.getByRole('button', { name: 'The month after' }).click();
    await expect(title).toHaveText(expected);
  }

  // 4726 is not a leap year, so Calistril has 28 days.
  await page.getByRole('button', { name: 'The month after' }).click();
  await expect(title).toHaveText('Calistril 4726 AR');
  await expect(page.locator('.cal__cell:not(.cal__cell--empty)')).toHaveCount(28);
});

test('a mark is the GM’s until they share it', async ({ page, context, request }) => {
  await request.post(
    `/api/gm/${world.gmToken}/campaigns/${table.campaignId}/calendar/events`,
    { data: { at: '4725-09-17', title: 'The ritual completes', shared: false } },
  );

  const sheet = await context.newPage();
  await sheet.goto(`/c/${playerToken}`);
  await sheet.locator('.sheet-tabs').getByRole('button', { name: 'Calendar' }).click();
  await expect(sheet.locator('.cal__entry')).toHaveCount(0);
  // Not merely hidden: the words are not on the page at all.
  await expect(sheet.locator('body')).not.toContainText('ritual');

  // The GM shares it from their own tab.
  await gmPage(page);
  const entry = page.locator('.cal__entry', { hasText: 'The ritual completes' });
  await expect(entry).toBeVisible();
  await entry.getByRole('button', { name: 'Share' }).click();
  await expect(page.locator('.notice')).toContainText('can see');

  await sheet.reload();
  await sheet.locator('.sheet-tabs').getByRole('button', { name: 'Calendar' }).click();
  await expect(sheet.locator('.cal__entry')).toContainText('The ritual completes');
  await sheet.close();
});
