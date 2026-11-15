/**
 * Effects, across two clients.
 *
 * The load-bearing part is the last test: the GM pushes an effect from the
 * dashboard and the player's sheet shows the changed number with the effect
 * named beside it. Everything in between -- the patch, the stream, the
 * overlay -- is only proved by looking at the other screen.
 */
import { expect, test } from '@playwright/test';

import { sandbox } from './sandbox.js';
import { loadWorld, PORTS } from './world.js';

const world = loadWorld(PORTS.desktop);
const table = sandbox(world.gmToken, 'the effects spec');

let playerToken;
let characterId;

test.beforeAll(async ({ request }) => {
  ({ playerToken, characterId } = await table.create(request, { characterName: 'Vex', level: 5 }));
  // A character with numbers to move.
  await request.patch(
    `/api/gm/${world.gmToken}/campaigns/${table.campaignId}/characters/${characterId}`,
    {
      data: {
        writes: [
          { path: 'level', value: 5 },
          { path: 'abilities', value: { str: 4, dex: 2, con: 3, int: 0, wis: 1, cha: 0 } },
          { path: 'ac', value: { rank: 'expert', itemBonus: 6, dexCap: 1 } },
          { path: 'saves', value: { will: { rank: 'expert' } } },
          { path: 'hp', value: { max: 70, current: 70 } },
        ],
      },
    },
  );
});
test.afterAll(async ({ request }) => { await table.archive(request); });

test('an effect the player writes moves the numbers and says so', async ({ page }) => {
  await page.goto(`/c/${playerToken}`);

  const ac = page.locator('.stat-row', { hasText: 'Armour Class' });
  await expect(ac.locator('.stat-row__value')).toHaveText('26');

  await page.getByRole('button', { name: 'Add an effect' }).click();
  const effect = page.locator('.effect').first();
  await effect.getByLabel('Effect 1 name').fill('Rage');
  await effect.getByLabel('What it changes').selectOption('ac');
  await effect.getByLabel('By how much').fill('-1');
  // The number field commits on blur, the way every other field here does.
  await effect.getByLabel('By how much').blur();

  await expect(ac.locator('.stat-row__value')).toHaveText('25');

  // And the row says which effect took the point, rather than simply being
  // one lower than the player expects.
  await ac.locator('.stat-row__head').click();
  await expect(ac.locator('.stat-row__working')).toContainText('-1 Rage');

  // Turned off, the sheet goes back exactly: nothing was written to `ac`.
  await effect.getByRole('checkbox').uncheck();
  await expect(ac.locator('.stat-row__value')).toHaveText('26');
});

test('a condition moves them too, without anybody writing an effect', async ({ page, request }) => {
  await request.patch(
    `/api/gm/${world.gmToken}/campaigns/${table.campaignId}/characters/${characterId}`,
    { data: { writes: [{ path: 'conditions', value: [{ slug: 'frightened', value: 2 }] }] } },
  );
  await page.goto(`/c/${playerToken}`);

  // Armour Class is a DC, which is the half of frightened people forget.
  const ac = page.locator('.stat-row', { hasText: 'Armour Class' });
  await expect(ac.locator('.stat-row__value')).toHaveText('24');

  const will = page.locator('.stat-row', { hasText: 'Will' });
  await will.locator('.stat-row__head').click();
  await expect(will.locator('.stat-row__working')).toContainText('-2 frightened 2');

  await request.patch(
    `/api/gm/${world.gmToken}/campaigns/${table.campaignId}/characters/${characterId}`,
    { data: { writes: [{ path: 'conditions', value: [] }] } },
  );
});

test('the GM pushes one from the dashboard and it lands on the sheet', async ({ page, context }) => {
  const sheet = await context.newPage();
  await sheet.goto(`/c/${playerToken}`);
  const ac = sheet.locator('.stat-row', { hasText: 'Armour Class' });
  await expect(ac.locator('.stat-row__value')).toHaveText('26');

  await page.goto(`/gm/${world.gmToken}#/campaign/${table.campaignId}/party`);
  await page.getByRole('button', { name: 'Push an effect' }).click();

  const dialog = page.locator('#push-effect-dialog');
  await dialog.getByLabel('Name').fill('Shield of Faith');
  await dialog.getByLabel('What it changes').selectOption('ac');
  await dialog.getByLabel('By how much').fill('2');
  await dialog.getByRole('button', { name: 'Push it' }).click();

  // On the GM's own panel, with what the number was before it.
  const pill = page.locator('.pc', { hasText: 'Vex' }).locator('.pill--accent');
  await expect(pill).toContainText('Shield of Faith');

  // And on the player's sheet, which nobody reloaded.
  await expect(ac.locator('.stat-row__value')).toHaveText('28');
  await sheet.close();
});
