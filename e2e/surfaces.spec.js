/**
 * The three surfaces, in a real browser.
 *
 * The load-bearing test is the last one: two clients, a GM change on one and
 * the shared screen on the other, proving the whole chain from a click through
 * the rules engine to SQLite to Server-Sent Events to the page.
 */
import { expect, test } from '@playwright/test';

import { loadWorld, PORTS } from './world.js';

const world = loadWorld(PORTS.desktop);

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

test.describe('the sheet’s Start here', () => {
  test('is open the first time and folds away for good', async ({ browser }) => {
    // A fresh context, because whether it is open is remembered per browser.
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`/c/${world.characterToken}`);
    const card = page.locator('.guide-card');
    await expect(card).toHaveAttribute('open', '');
    await expect(card).toContainText('Kestrel Vane');
    await expect(card).toContainText('It works with no signal');

    await card.locator('summary').click();
    await expect(card).not.toHaveAttribute('open', '');

    await page.reload();
    await expect(page.locator('.guide-card')).not.toHaveAttribute('open', '');
    await context.close();
  });

  test('does not offer to fill in a sheet that is filled in', async ({ page }) => {
    await page.goto(`/c/${world.characterToken}`);
    await expect(page.locator('#guide-fill')).toHaveCount(0);
    await expect(page.locator('#guide-saving')).toHaveCount(1);
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

    await page.locator('.encounter-item__open', { hasText: 'Ambush in the stairwell' }).click();

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

test.describe('the links panel', () => {
  test('shows a new link once, and never again', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('s');

    const row = page.locator('.link-row', { hasText: 'Shared screen' });
    await row.getByRole('button', { name: 'Rotate' }).click();

    const field = page.locator('.link-reveal__url');
    await expect(field).toBeVisible();
    const url = await field.inputValue();
    expect(url).toMatch(/\/table\/[0-9A-HJKMNP-TV-Z]{26}$/);

    // The link works.
    const table = await page.context().newPage();
    expect((await table.goto(url)).status()).toBe(200);
    await table.close();

    // And is gone from the dashboard the moment the dialog closes.
    await page.locator('#link-dialog .dialog__close').click();
    await expect(page.locator('.link-reveal')).toHaveCount(0);
    expect(await page.content()).not.toContain(url.split('/').pop());

    // A reload does not bring it back.
    await page.reload();
    expect(await page.content()).not.toContain(url.split('/').pop());
  });

  test('rotating kills the link it replaced', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('s');

    const row = page.locator('.link-row', { hasText: 'Kestrel Vane' });
    await row.getByRole('button', { name: /Rotate|Make a link/ }).click();
    const first = await page.locator('.link-reveal__url').inputValue();
    await page.locator('#link-dialog .dialog__close').click();

    await row.getByRole('button', { name: 'Rotate' }).click();
    const second = await page.locator('.link-reveal__url').inputValue();
    expect(second).not.toBe(first);
    await page.locator('#link-dialog .dialog__close').click();

    const other = await page.context().newPage();
    expect((await other.goto(first)).status()).toBe(404);
    expect((await other.goto(second)).status()).toBe(200);
    await other.close();
  });

  test('never renders a token it was not just given', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('s');
    await expect(page.locator('.links')).toBeVisible();
    const html = await page.content();
    // The listing says what exists, not what it is.
    expect(html).not.toContain(world.tableToken);
    expect(html).not.toContain(world.characterToken);
  });
});

test.describe('the setup tab', () => {
  test('sets a campaign’s accent colour, and the chrome follows', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('s');

    await page.locator('.accent[data-accent="#F59E0B"]').click();
    await expect(page.locator('.accent[aria-pressed="true"]'))
      .toHaveAttribute('data-accent', '#F59E0B');

    // The accent is what tells two campaigns apart at a glance, so it has to
    // reach the chrome and survive a reload rather than just the swatch.
    await expect(async () => {
      const accent = await page.evaluate(() => getComputedStyle(document.documentElement)
        .getPropertyValue('--campaign-accent').trim());
      expect(accent).toBe('#F59E0B');
    }).toPass({ timeout: 5000 });

    await page.reload();
    await page.locator('body').press('s');
    await expect(page.locator('.accent[aria-pressed="true"]'))
      .toHaveAttribute('data-accent', '#F59E0B');
  });

  test('adds a character, who then appears in the party and the links', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('s');

    await page.locator('#new-character-name').fill('Vashti');
    await page.locator('#new-character-player').fill('Robin');
    await page.locator('.roster__add').getByRole('button', { name: 'Add' }).click();

    await expect(page.locator('.roster__row', { hasText: 'Vashti' })).toBeVisible();
    await expect(page.locator('.link-row', { hasText: 'Vashti' })).toContainText('no link yet');

    await page.locator('body').press('t');
    await expect(page.locator('.pc', { hasText: 'Vashti' })).toBeVisible();
  });

  test('writes a session up, and marks the campaign played', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('s');

    await page.locator('#session-title').fill('The sealed door');
    await page.locator('#session-body').fill('Nobody expected the drakes.');
    await page.getByRole('button', { name: 'Save this session' }).click();

    const entry = page.locator('.session', { hasText: 'The sealed door' });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('drakes');

    // Deleting offers an undo rather than a confirmation, and the undo works.
    await entry.getByRole('button', { name: /Delete the session/ }).click();
    await expect(page.locator('.session', { hasText: 'The sealed door' })).toHaveCount(0);
    await page.locator('.notice').getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.session', { hasText: 'The sealed door' })).toBeVisible();
  });
});

test.describe('reordering', () => {
  /**
   * Dragging is untestable in a way that matters here -- Playwright can
   * synthesise it, but a real HTML5 drag is a different code path. The keyboard
   * route is the one that can be asserted honestly, and it is also the one that
   * would otherwise never have been written.
   */
  test('moves an encounter with the keyboard, and it stays moved', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('e');

    // Two more encounters, so there is an order to change.
    for (const name of ['Second', 'Third']) {
      await page.getByRole('button', { name: 'New' }).first().click();
      await page.locator('input[aria-label="Encounter name"]').fill(name);
      await page.locator('input[aria-label="Encounter name"]').blur();
      await expect(page.locator('.encounter-item', { hasText: name })).toBeVisible();
    }

    const names = () => page.locator('.encounter-item__open').allTextContents();
    const before = await names();
    expect(before.length).toBeGreaterThanOrEqual(3);

    const last = page.locator('.encounter-item').last().locator('[data-reorder-handle]');
    await last.focus();
    await last.press('ArrowUp');

    await expect(async () => {
      expect(await names()).not.toEqual(before);
    }).toPass({ timeout: 5000 });

    // Focus stays on the handle, so a second press moves the same item again
    // without hunting for it. This is what makes keyboard reordering usable
    // rather than merely present.
    await expect(page.locator(':focus')).toHaveAttribute('data-reorder-handle', '');

    const moved = await names();
    await page.reload();
    await page.locator('body').press('e');
    await expect(async () => {
      expect(await names()).toEqual(moved);
    }).toPass({ timeout: 5000 });
  });
});

test.describe('Start here', () => {
  test('opens on a keystroke, and its contents list matches its sections', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('?');

    await expect(page.locator('.guide__intro .panel__title')).toHaveText('Start here');
    // The whole reason the contents list is generated: it cannot say anything
    // the page does not have.
    const contents = await page.locator('.guide__toc-list a').allInnerTexts();
    const headings = await page.locator('.guide__section > .panel__title').allInnerTexts();
    expect(contents).toEqual(headings);
    expect(contents.length).toBeGreaterThan(3);
  });

  test('says which campaign you are on, and takes you to a tab', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('?');
    await expect(page.locator('.guide__intro')).toContainText('Abomination Vaults');

    await page.locator('#tabs').getByText('Start here').click();
    await page.locator('#tabs').getByText('Start here').click();
    await page.locator('.guide__section').getByRole('button', { name: 'Initiative' }).click();
    await expect(page.locator('#tabs button[aria-current="page"]')).toContainText('Initiative');
  });

  test('prints every key the dashboard actually listens for', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('?');
    const keys = await page.locator('.guide__keys .kbd').allInnerTexts();
    for (const key of ['T', 'I', 'E', 'S', 'A', '?', 'C', 'R', 'D', 'K', 'Esc', 'Space', 'P']) {
      expect(keys, `the guide does not mention ${key}`).toContain(key);
    }
    // And the ones it names work. R opens the drawer on the reference tab.
    await page.locator('body').press('r');
    await expect(page.locator('#drawer')).toBeVisible();
  });

  test('tells a new campaign what to do next, and stops once it is done', async ({ page }) => {
    // The point of assembling this page at render time: a campaign with nobody
    // in it gets first steps, and the one that has been running for weeks does
    // not have to scroll past them.
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('?');
    await expect(page.locator('#first')).toHaveCount(0);

    page.once('dialog', (dialog) => dialog.accept('Thursday: a brand new game'));
    await page.locator('body').press('a');
    await page.getByRole('button', { name: 'New campaign' }).click();
    await expect(page.locator('#campaign-name')).toContainText('brand new game');

    await page.locator('body').press('?');
    await expect(page.locator('#first')).toContainText('add your players');
  });

  test('never renders a token, like every other panel', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('?');
    const html = await page.content();
    expect(html).not.toContain(world.tableToken);
    expect(html).not.toContain(world.characterToken);
  });
});

test.describe('a link before the character has a name', () => {
  test('a player name is enough to make a row, a link, and a working sheet', async ({ page }) => {
    // The question this answers: can a GM hand out links knowing only who is
    // playing, and let each player fill in who they are playing?
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('s');

    await page.locator('#new-character-player').fill('Robin');
    await page.locator('#new-character-level').fill('3');
    await page.locator('.roster__add').getByRole('button', { name: 'Add' }).click();

    // The roster calls it after the player, and says it has no name yet.
    const row = page.locator('.roster__row', { hasText: 'Robin’s character' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('not named yet');

    // And so does the links panel, so the GM knows which link is whose.
    const link = page.locator('.link-row', { hasText: 'Robin’s character' });
    await link.getByRole('button', { name: /Make a link|Rotate/ }).click();
    const url = await page.locator('.link-reveal__url').inputValue();
    await page.locator('#link-dialog .dialog__close').click();

    // Opening it works, and the sheet agrees about what it is called.
    const player = await page.context().newPage();
    await player.goto(url);
    await expect(player.locator('#character-name')).toHaveText('Robin’s character');

    // Naming the character is the player's to do, and it reaches the GM.
    await player.getByLabel('Character name', { exact: true }).fill('Wren Dallow');
    await expect(player.locator('#save-state')).toHaveText('Saved', { timeout: 5000 });
    await expect(player.locator('#character-name')).toHaveText('Wren Dallow');
    await player.close();

    await page.reload();
    await page.locator('body').press('s');
    await expect(page.locator('.roster__row', { hasText: 'Wren Dallow' })).toBeVisible();
    await expect(page.locator('.roster__row', { hasText: 'Robin’s character' })).toHaveCount(0);
  });

  test('still refuses a row with neither name', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('s');
    const before = await page.locator('.roster__row').count();
    await page.locator('.roster__add').getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('.roster__row')).toHaveCount(before);
  });
});

test.describe('removing a character', () => {
  test('takes their link with them, and undo brings the sheet back', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('s');

    await page.locator('#new-character-name').fill('Temporary Tim');
    await page.locator('#new-character-player').fill('Pat');
    await page.locator('.roster__add').getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('.roster__row', { hasText: 'Temporary Tim' })).toBeVisible();

    // Give them a link, so removal has something to revoke.
    await page.locator('.link-row', { hasText: 'Temporary Tim' })
      .getByRole('button', { name: /Make a link|Rotate/ }).click();
    const url = await page.locator('.link-reveal__url').inputValue();
    await page.locator('#link-dialog .dialog__close').click();

    const player = await page.context().newPage();
    expect((await player.goto(url)).status()).toBe(200);

    await page.getByRole('button', { name: 'Remove Temporary Tim' }).click();
    await expect(page.locator('.roster__row', { hasText: 'Temporary Tim' })).toHaveCount(0);
    await expect(page.locator('.notices')).toContainText('Their link no longer works');

    // And it really does not: the link is dead the moment they are gone.
    expect((await player.goto(url)).status()).toBe(404);
    await player.close();

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.roster__row', { hasText: 'Temporary Tim' })).toBeVisible();
    await expect(page.locator('.link-row', { hasText: 'Temporary Tim' })).toContainText('no link yet');
  });

  test('says whose sheet it is about to remove, for a screen reader too', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('s');
    // Not five buttons all called "Remove".
    await expect(page.getByRole('button', { name: 'Remove Kestrel Vane' })).toBeVisible();
  });
});
