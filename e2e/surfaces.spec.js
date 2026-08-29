/**
 * The three surfaces, in a real browser.
 *
 * The load-bearing test is the last one: two clients, a GM change on one and
 * the shared screen on the other, proving the whole chain from a click through
 * the rules engine to SQLite to Server-Sent Events to the page.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const world = JSON.parse(readFileSync(new URL('./.world.json', import.meta.url), 'utf8'));

test.describe('the player’s character sheet', () => {
  test('loads and computes its own numbers', async ({ page }) => {
    await page.goto(`/c/${world.characterToken}`);

    await expect(page.locator('#character-name')).toHaveText('Kestrel Vane');
    await expect(page.locator('#campaign-name')).toContainText('Abomination Vaults');

    // AC: 10 + 1 capped Dex + 9 expert at level 5 + 6 item.
    const ac = page.locator('.stat', { hasText: 'Armour Class' });
    await expect(ac.locator('.stat__total')).toHaveText('26');
    await expect(ac.locator('.stat__working')).toContainText('capped');
  });

  test('never puts the token in the title', async ({ page }) => {
    await page.goto(`/c/${world.characterToken}`);
    await expect(page).toHaveTitle('Character sheet');
    const html = await page.content();
    expect(html).not.toContain(world.characterToken);
  });

  test('saves an edit and says so', async ({ page }) => {
    await page.goto(`/c/${world.characterToken}`);
    const notes = page.getByLabel('Notes', { exact: true });
    await notes.fill('Owes the innkeeper 4 gp');
    await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 5000 });

    await page.reload();
    await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('Owes the innkeeper 4 gp');
  });

  test('refuses a link that is not a sheet', async ({ page }) => {
    const response = await page.goto(`/c/${world.tableToken}`);
    expect(response.status()).toBe(404);
    await expect(page.locator('h1')).toHaveText('Not found');
  });
});

test.describe('the GM dashboard', () => {
  test('opens on the party, live from the sheets', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await expect(page.locator('#campaign-name')).toContainText('Abomination Vaults');
    await expect(page.locator('.pc').first()).toContainText('Dorn Ashfell');
    await expect(page.locator('.pc', { hasText: 'Kestrel' })).toContainText('26');
  });

  test('switches campaign with a keystroke', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('c');
    await expect(page.locator('#switcher')).toBeVisible();
    await page.locator('body').press('Escape');
    await expect(page.locator('#switcher')).toBeHidden();
  });

  test('searches creatures and prices what it adds', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('e');

    await page.getByLabel('Search creatures by name').fill('goblin warrior');
    await expect(page.locator('.result').first()).toContainText('Goblin Warrior');

    await page.getByLabel('Encounter', { exact: true })
      .selectOption({ label: 'Ambush in the stairwell' });

    // Two level -1 goblins against a level 5 party are off the encounter table,
    // so the builder must refuse a difficulty rather than invent one.
    await expect(page.locator('.budget__band')).toHaveCount(0);
    await expect(page.locator('.notice')).toContainText('beyond the encounter table');
  });
});

test.describe('the shared screen', () => {
  test('shows players by number and creatures by descriptor', async ({ page }) => {
    await page.goto(`/table/${world.tableToken}`);
    await expect(page.locator('#connection')).toHaveAttribute('data-state', 'live');

    await expect(page.locator('.turn', { hasText: 'Kestrel Vane' })).toContainText('50/62');
    const goblin = page.locator('.turn', { hasText: 'Goblin Warrior A' });
    await expect(goblin.locator('.turn__descriptor')).toHaveText('Unharmed');
    await expect(goblin).not.toContainText('/6');
  });

  test('does not leak a hidden combatant, by name or by gap', async ({ page }) => {
    await page.goto(`/table/${world.tableToken}`);
    await expect(page.locator('.turn')).toHaveCount(3);
    await expect(page.locator('.order')).not.toContainText('Goblin Warrior B');
    // Nothing in the markup hints that a fourth row was removed.
    expect(await page.locator('.order').innerHTML()).not.toContain('Goblin Warrior B');
  });

  test('has no control that can write', async ({ page }) => {
    await page.goto(`/table/${world.tableToken}`);
    const inputs = await page.locator('input, textarea, select').count();
    expect(inputs).toBe(0);
    // The only button is the density switch.
    await expect(page.locator('button')).toHaveCount(1);
  });
});

test.describe('two clients', () => {
  test('a GM hit point change reaches the shared screen over SSE', async ({ browser }) => {
    const table = await browser.newPage();
    const gm = await browser.newPage();

    await table.goto(`/table/${world.tableToken}`);
    await expect(table.locator('#connection')).toHaveAttribute('data-state', 'live');
    await expect(table.locator('.turn', { hasText: 'Kestrel Vane' })).toContainText('50/62');

    await gm.goto(`/gm/${world.gmToken}`);
    await gm.locator('body').press('i');

    const row = gm.locator('.combatant', { hasText: 'Kestrel Vane' });
    await row.locator('.combatant__damage').fill('18');
    await row.locator('.combatant__damage').press('Enter');

    // No reload on the table page: this must arrive by itself.
    await expect(table.locator('.turn', { hasText: 'Kestrel Vane' }))
      .toContainText('32/62', { timeout: 8000 });

    await table.close();
    await gm.close();
  });

  test('a turn advance moves the highlight and is announced', async ({ browser }) => {
    const table = await browser.newPage();
    const gm = await browser.newPage();

    await table.goto(`/table/${world.tableToken}`);
    await expect(table.locator('#connection')).toHaveAttribute('data-state', 'live');
    const firstActive = await table.locator('.turn--current .turn__name').textContent();

    await gm.goto(`/gm/${world.gmToken}`);
    await gm.locator('body').press('i');
    await gm.locator('body').press('n');

    await expect(async () => {
      const nowActive = await table.locator('.turn--current .turn__name').textContent();
      expect(nowActive).not.toBe(firstActive);
    }).toPass({ timeout: 8000 });

    await expect(table.locator('#announcement')).toContainText('turn');

    await table.close();
    await gm.close();
  });

  test('a condition the GM pushes reaches the player’s sheet', async ({ browser }) => {
    const sheet = await browser.newPage();
    const gm = await browser.newPage();

    await sheet.goto(`/c/${world.characterToken}`);
    await gm.goto(`/gm/${world.gmToken}`);
    await gm.locator('body').press('i');

    const row = gm.locator('.combatant', { hasText: 'Kestrel Vane' });
    await row.locator('select[aria-label*="Add a condition"]').selectOption('frightened');

    await expect(sheet.locator('.pill', { hasText: 'Frightened' }))
      .toBeVisible({ timeout: 8000 });

    await sheet.close();
    await gm.close();
  });
});
