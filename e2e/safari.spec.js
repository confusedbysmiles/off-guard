/**
 * The same application in WebKit, on a tablet.
 *
 * The rest of the suite runs in Chromium, which is the right trade for a
 * private application: a browser matrix costs more to maintain than it catches.
 * This file is the exception, because the table does not run on Chromium. The
 * players open their sheets on phones and someone has now run the whole
 * evening off an iPad, and the parts of this application that could plausibly
 * differ between engines are specific and few:
 *
 *   - `document.adoptedStyleSheets`, which the accent colours need because the
 *     policy has no `unsafe-inline` and so no `style` attribute either
 *   - `<dialog>` and `showModal`
 *   - `EventSource`, which is the whole shared screen
 *   - `localStorage` inside a `try`, which is how the sheet survives a reload
 *   - `<details>` with its default marker replaced, which is the Start here
 *     card and the one place the two engines disagreed by default
 *
 * So this covers those, not the application again. WebKit is not Safari and a
 * headless tablet is not an iPad, but an engine-level regression in any of them
 * would show up here rather than at the table.
 */
import { expect, test } from '@playwright/test';

import { loadWorld, PORTS } from './world.js';

const world = loadWorld(PORTS.webkit);

test.describe('the character sheet', () => {
  test('computes its own numbers, and an edit survives a reload', async ({ page }) => {
    await page.goto(`/c/${world.characterToken}`);
    await expect(page.locator('#character-name')).toHaveText('Kestrel Vane');

    // The rules engine, running in this engine's JavaScript rather than V8.
    const ac = page.locator('.stat', { hasText: 'Armour Class' });
    await expect(ac.locator('.stat__total')).toHaveText('26');

    // The store writes locally first and mirrors into localStorage before the
    // network is touched. Safari is the browser most likely to refuse that.
    const notes = page.getByLabel('Notes', { exact: true });
    await notes.fill('Rope, 50 feet');
    await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 5000 });
    await page.reload();
    await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('Rope, 50 feet');
  });
});

test.describe('the Start here card', () => {
  test('folds and unfolds, with its own marker', async ({ page }) => {
    await page.goto(`/c/${world.characterToken}`);
    const card = page.locator('.guide-card');
    const summary = card.locator('summary');

    // The default marker is suppressed and one is drawn instead, because the
    // two engines disagree about the default and it is load-bearing here.
    const marker = await summary.evaluate((el) => {
      const style = getComputedStyle(el, '::before');
      return { content: style.content, width: style.width };
    });
    expect(marker.content).not.toBe('none');
    expect(parseFloat(marker.width)).toBeGreaterThan(0);

    await summary.click();
    await expect(card).not.toHaveAttribute('open', '');
    await summary.click();
    await expect(card).toHaveAttribute('open', '');
    await expect(card).toContainText('It works with no signal');
  });
});

test.describe('the GM dashboard', () => {
  test('paints the accent through a constructed stylesheet', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('s');
    await page.locator('.accent[data-accent="#F59E0B"]').click();

    // Nothing sets this property in a static sheet: if it resolves, the
    // constructed stylesheet was adopted and applied.
    await expect(async () => {
      const accent = await page.evaluate(() => getComputedStyle(document.documentElement)
        .getPropertyValue('--campaign-accent').trim());
      expect(accent).toBe('#F59E0B');
    }).toPass({ timeout: 5000 });
  });

});

test.describe('the shared screen', () => {
  test('holds an EventSource open and takes a change through it', async ({ browser }) => {
    const table = await browser.newPage();
    const gm = await browser.newPage();

    await table.goto(`/table/${world.tableToken}`);
    await expect(table.locator('#connection')).toHaveAttribute('data-state', 'live');

    // Read the hit points rather than assume them: this project shares the
    // seeded database with the Chromium one, which has already changed them.
    const kestrel = table.locator('.turn', { hasText: 'Kestrel Vane' });
    const [, before, max] = /(\d+)\/(\d+)/.exec(await kestrel.innerText());

    await gm.goto(`/gm/${world.gmToken}`);
    await gm.locator('body').press('i');
    const row = gm.locator('.combatant', { hasText: 'Kestrel Vane' });
    await row.locator('.combatant__damage').fill('7');
    await row.locator('.combatant__damage').press('Enter');

    // No reload: this has to arrive down the stream on its own.
    await expect(kestrel).toContainText(`${Number(before) - 7}/${max}`, { timeout: 8000 });

    await table.close();
    await gm.close();
  });
});

/**
 * Last, deliberately: rotating a link revokes the one it replaced, and the
 * shared screen above is watching through the token this would revoke.
 */
test.describe('the links panel', () => {
  test('opens a modal dialog, and closing it takes the token out of the page', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('s');

    // The link dialog is the one that has to behave: it uses `showModal`, and
    // it removes itself on close so that a token shown once is not left in the
    // markup. Both are engine behaviour, and this is the only surface where
    // getting them wrong leaks a credential.
    await page.locator('.link-row', { hasText: 'Shared screen' })
      .getByRole('button', { name: 'Rotate' }).click();

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    const url = await page.locator('.link-reveal__url').inputValue();
    expect(url).toMatch(/\/table\/[0-9A-HJKMNP-TV-Z]{26}$/);

    await page.locator('#link-dialog .dialog__close').click();
    await expect(page.locator('dialog')).toHaveCount(0);
    expect(await page.content()).not.toContain(url.split('/').pop());
  });
});
