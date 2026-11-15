/**
 * Where the cards on a panel end up.
 *
 * A two-column grid puts every card in a row with the card beside it, and a
 * row is as tall as its tallest member -- so Strikes, which on a real
 * character is eight hundred pixels of weapons, left a gap beside it the
 * height of seven Conditions cards. Which cards were paired changed whenever
 * one was added, so the holes moved around and the panel looked different for
 * no reason a reader could see.
 *
 * This needs a character with a full weapon rack, which is why it has its own
 * campaign rather than reading the shared fixture: the fixture's characters
 * carry no strikes at all, and against them the old layout and the new one are
 * indistinguishable.
 */
import { expect, test } from '@playwright/test';

import { sandbox } from './sandbox.js';
import { loadWorld, PORTS } from './world.js';

const world = loadWorld(PORTS.desktop);
const table = sandbox(world.gmToken, 'the layout spec');

let playerToken;

test.beforeAll(async ({ request }) => {
  const { characterId } = await table.create(request, { characterName: 'Armoury', level: 5 });
  await request.patch(
    `/api/gm/${world.gmToken}/campaigns/${table.campaignId}/characters/${characterId}`,
    {
      data: {
        writes: [{
          path: 'strikes',
          value: ['Longsword', 'Shortbow', 'Dagger', 'Javelin', 'Sling', 'Club'].map((name) => ({
            name, mod: 12, damage: '1d8+4', damageType: 'slashing', traitsText: 'versatile p',
          })),
        }],
      },
    },
  );
});
test.afterAll(async ({ request }) => { await table.archive(request); });

test('stacks a panel’s cards without leaving gaps between them', async ({ page }) => {
  await page.goto(`/c/${playerToken ?? table.playerToken}`);
  await page.locator('.sheet-tabs').getByRole('button', { name: 'Combat', exact: true }).click();
  await expect(page.locator('#panel-combat')).toBeVisible();

  // The card that causes it, so a fixture that quietly lost its weapons shows
  // up as a failure here rather than as a test that proves nothing.
  const strikes = page.locator('#panel-combat > .card', { hasText: 'Strikes' });
  expect((await strikes.boundingBox()).height).toBeGreaterThan(600);

  const holes = await page.evaluate(() => {
    const columns = new Map();
    for (const card of document.querySelectorAll('#panel-combat > .card')) {
      const box = card.getBoundingClientRect();
      if (!box.height) continue;
      const key = Math.round(box.x);
      if (!columns.has(key)) columns.set(key, []);
      columns.get(key).push({
        name: card.querySelector('.section__title')?.textContent?.trim() ?? '?',
        top: box.y + window.scrollY,
        bottom: box.y + window.scrollY + box.height,
      });
    }

    const found = [];
    for (const cards of columns.values()) {
      cards.sort((a, b) => a.top - b.top);
      for (let i = 1; i < cards.length; i += 1) {
        const gap = Math.round(cards[i].top - cards[i - 1].bottom);
        // The gap between two cards is a couple of rem. Anything approaching a
        // card's own height is a hole left by a row that was taller elsewhere.
        if (gap > 120) found.push(`${gap}px above ${cards[i].name}`);
      }
    }
    return found;
  });

  expect(holes).toEqual([]);
});
