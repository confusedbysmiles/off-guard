/**
 * An option the GM wrote, from the form to a player's sheet.
 *
 * The whole chain in one place, because every link in it is new and the
 * interesting failures are between them: a form that reads its own fields
 * wrongly, a record that saves but does not match the picker's filter, an id
 * the derivation cannot resolve. The unit tests pin each link; these prove they
 * are joined.
 *
 * In a campaign of its own -- see `sandbox`, which exists because the first
 * version of this file wrote into the shared fixture and broke three tests in
 * `surfaces.spec.js` that were entitled to what it changed.
 */
import { expect, test } from '@playwright/test';

import { sandbox } from './sandbox.js';
import { loadWorld, PORTS } from './world.js';

const world = loadWorld(PORTS.desktop);

const table = sandbox(world.gmToken, 'the homebrew spec');

let campaignId;
let playerToken;

test.beforeAll(async ({ request }) => {
  ({ campaignId, playerToken } = await table.create(request));
});

test.afterAll(async ({ request }) => { await table.archive(request); });

/** The Setup tab of this spec's own campaign. */
async function setupTab(page) {
  await page.goto(`/gm/${world.gmToken}#/campaign/${campaignId}/setup`);
  await expect(page.getByRole('heading', { name: 'Options this table wrote' })).toBeVisible();
}

test.describe('an option the GM wrote', () => {
  test('is written in a form and lands in a player’s picker', async ({ page }) => {
    await setupTab(page);

    await page.locator('.hb-new').getByRole('button', { name: /^Background/ }).click();
    const dialog = page.locator('#homebrew-dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('#hb-name').fill('Vault-born');
    // The restricted boost: two attributes, the way a printed background reads.
    await dialog.locator('#hb-boost-str').check();
    await dialog.locator('#hb-boost-con').check();
    await dialog.locator('#hb-skill').selectOption('athletics');
    await dialog.locator('#hb-lore').fill('Vault Lore');
    await dialog.locator('#hb-description').fill('You were born below the ground.');
    await dialog.getByRole('button', { name: 'Add it' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.locator('.hb-item', { hasText: 'Vault-born' })).toBeVisible();

    // Now the player, who has never heard of any of this.
    await page.goto(`/build/${playerToken}`);
    await page.getByRole('button', { name: /^Background/ }).click();

    const picker = page.locator('.picker');
    await expect(picker).toBeVisible();
    await picker.locator('#picker-search').fill('Vault-born');

    const row = picker.locator('.picker__row', { hasText: 'Vault-born' });
    await expect(row).toBeVisible();
    // Badged, so it is visibly not out of a book.
    await expect(row.locator('.pill--accent')).toHaveText('This table');

    await row.locator('.picker__choose').click();
    await expect(picker).toBeHidden();

    await expect(page.locator('.slot-row', { hasText: 'Background' }).first())
      .toContainText('Vault-born');
    // The summary agrees, which is the derivation talking rather than the slot
    // echoing back what was clicked.
    await expect(page.locator('#summary')).toContainText('Vault-born');
  });

  test('is editable, and the edit reaches the same player', async ({ page }) => {
    await setupTab(page);

    const item = page.locator('.hb-item', { hasText: 'Vault-born' });
    await item.getByRole('button', { name: 'Edit' }).click();

    const dialog = page.locator('#homebrew-dialog');
    await expect(dialog.locator('#hb-name')).toHaveValue('Vault-born');
    // The form came back filled in rather than blank: a checkbox the record
    // holds is ticked, which is the part that silently regresses.
    await expect(dialog.locator('#hb-boost-str')).toBeChecked();
    await expect(dialog.locator('#hb-lore')).toHaveValue('Vault Lore');

    await dialog.locator('#hb-name').fill('Vault-born deep');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    // The character who chose it keeps it across the rename -- a build stores
    // the id, and the id does not move.
    await page.goto(`/build/${playerToken}`);
    await expect(page.locator('.slot-row', { hasText: 'Background' }).first())
      .toContainText('Vault-born deep');
  });

  test('says how many characters have chosen it before deleting it', async ({ page }) => {
    await setupTab(page);
    const item = page.locator('.hb-item', { hasText: 'Vault-born deep' });
    await expect(item.locator('.pill')).toHaveText('1 character');

    page.once('dialog', (confirm) => {
      expect(confirm.message()).toContain('1 character has chosen it');
      confirm.dismiss();
    });
    await item.getByRole('button', { name: /^Delete/ }).click();

    // Dismissed, so it is still there.
    await expect(page.locator('.hb-item', { hasText: 'Vault-born deep' })).toBeVisible();
  });
});
