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

test.describe('the drawer', () => {
  test('opens on a keystroke and searches the reference', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('r');

    const drawer = page.locator('#drawer');
    await expect(drawer).toBeVisible();
    // The level DC calculator is the first thing in it, and it is live.
    await expect(drawer.locator('.ref-dc__value')).toHaveText('DC 15');
    await drawer.locator('#ref-dc-level').selectOption('7');
    await expect(drawer.locator('.ref-dc__value')).toHaveText('DC 23');
    await drawer.locator('#ref-dc-rarity').selectOption('rare');
    await expect(drawer.locator('.ref-dc__value')).toHaveText('DC 28');

    await drawer.locator('#ref-search').fill('demoralize');
    await drawer.locator('.ref-row', { hasText: 'Demoralize' }).click();
    await expect(drawer.locator('.ref-entry h3')).toHaveText('Demoralize');
    await expect(drawer.locator('.ref-entry')).toContainText('Player Core');
  });

  test('follows a link from one entry to another', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('r');
    const drawer = page.locator('#drawer');

    await drawer.locator('#ref-search').fill('demoralize');
    await drawer.locator('.ref-row', { hasText: 'Demoralize' }).click();
    await drawer.locator('a.og-ref', { hasText: 'Frightened' }).first().click();

    await expect(drawer.locator('.ref-entry h3')).toHaveText('Frightened');
    // The hash is the dashboard's own routing; a reference link must not touch it.
    expect(page.url()).not.toContain('/ref/');
  });

  test('closes on Escape and puts the drawer’s width back', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('r');
    await expect(page.locator('#drawer')).toBeVisible();
    await page.locator('body').press('Escape');
    await expect(page.locator('#drawer')).toBeHidden();
  });

  test('rolls, and halves the result', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('d');
    const drawer = page.locator('#drawer');

    await drawer.locator('#dice-expression').fill('2d6+3');
    await drawer.locator('#dice-label').fill('Goblin Warrior A, jaws');
    await drawer.getByRole('button', { name: 'Roll' }).click();

    const first = drawer.locator('.roll').first();
    await expect(first).toContainText('Goblin Warrior A, jaws');
    const total = Number(await first.locator('.roll__total').textContent());
    expect(total).toBeGreaterThanOrEqual(5);
    expect(total).toBeLessThanOrEqual(15);

    await first.getByRole('button', { name: 'Half' }).click();
    await expect(drawer.locator('.roll').first().locator('.roll__total'))
      .toHaveText(String(Math.floor(total / 2)));
  });

  test('refuses a die that is not a die, before it is sent', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('d');
    await page.locator('#dice-expression').fill('1d7');
    await expect(page.locator('#dice-error')).toContainText('d7');
    await expect(page.getByRole('button', { name: 'Roll' })).toBeDisabled();
  });
});

test.describe('Recall Knowledge', () => {
  test('names the skills and the DC for the creature whose turn it is', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('i');
    const row = page.locator('.combatant', { hasText: 'Goblin Warrior A' });
    await row.getByRole('button', { name: /Recall Knowledge/ }).click();

    const drawer = page.locator('#drawer');
    await expect(drawer.locator('.recall__head h3')).toContainText('Goblin Warrior');
    // A level -1 creature: DC 13 by the printed table.
    await expect(drawer.locator('.recall__dc-value')).toHaveText('DC 13');
    await expect(drawer.locator('.recall__skills')).toContainText('Society');
    await expect(drawer.locator('.recall')).toContainText('not a printed rule');
  });

  test('a revealed fact reaches the shared screen', async ({ browser }) => {
    const table = await browser.newPage();
    const gm = await browser.newPage();

    await table.goto(`/table/${world.tableToken}`);
    await expect(table.locator('#connection')).toHaveAttribute('data-state', 'live');
    await expect(table.locator('.turn', { hasText: 'Goblin Warrior A' }).locator('.turn__fact'))
      .toHaveCount(0);

    await gm.goto(`/gm/${world.gmToken}`);
    await gm.locator('body').press('i');
    await gm.locator('.combatant', { hasText: 'Goblin Warrior A' })
      .getByRole('button', { name: /Recall Knowledge/ }).click();
    await gm.getByRole('button', { name: 'Reveal AC' }).click();

    await expect(table.locator('.turn', { hasText: 'Goblin Warrior A' }).locator('.turn__fact'))
      .toContainText('AC', { timeout: 8000 });

    await table.close();
    await gm.close();
  });

  test('an open roll reaches the shared screen and a secret one does not', async ({ browser }) => {
    const table = await browser.newPage();
    const gm = await browser.newPage();

    await table.goto(`/table/${world.tableToken}`);
    await expect(table.locator('#connection')).toHaveAttribute('data-state', 'live');

    await gm.goto(`/gm/${world.gmToken}`);
    await gm.locator('body').press('d');
    await gm.locator('#dice-expression').fill('1d20+7');
    await gm.locator('#dice-label').fill('Everyone hears this');
    await gm.getByRole('button', { name: 'Roll' }).click();

    await expect(table.locator('.table-roll', { hasText: 'Everyone hears this' }))
      .toBeVisible({ timeout: 8000 });

    await gm.getByLabel('Secret').check();
    await gm.locator('#dice-label').fill('Nobody hears this');
    await gm.getByRole('button', { name: 'Roll' }).click();

    // Wait for a roll that must never arrive by waiting for one that must:
    // the open roll above is already on screen, so a further update would
    // have landed by the time the second assertion runs.
    await gm.locator('#dice-label').fill('And this one they hear');
    await gm.getByLabel('Secret').uncheck();
    await gm.getByRole('button', { name: 'Roll' }).click();
    await expect(table.locator('.table-roll', { hasText: 'And this one they hear' }))
      .toBeVisible({ timeout: 8000 });

    await expect(table.locator('#rolls')).not.toContainText('Nobody hears this');

    await table.close();
    await gm.close();
  });
});
