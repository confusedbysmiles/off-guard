/**
 * The Pathbuilder import, through the dialog a player actually uses.
 *
 * The server side of this has been covered by unit tests since it was written;
 * the dialog never was, which is how a break in it could go unseen. The file
 * input is the part that cannot be tested any other way -- `app.inject` and a
 * direct call to the preview endpoint both skip exactly the code a player
 * touches.
 */
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { sandbox } from './sandbox.js';
import { loadWorld, PORTS } from './world.js';

const world = loadWorld(PORTS.desktop);
const table = sandbox(world.gmToken, 'the import spec');

const EXPORT = fileURLToPath(new URL('../tests/fixtures/pathbuilder/fighter-5.json', import.meta.url));

let playerToken;

test.beforeAll(async ({ request }) => { ({ playerToken } = await table.create(request)); });
test.afterAll(async ({ request }) => { await table.archive(request); });

/** The import button lives on the Character panel, beside the identity card. */
async function openImport(page, token = playerToken) {
  await page.goto(`/c/${token}`);
  await page.locator('.sheet-tabs').getByRole('button', { name: 'Character', exact: true }).click();
  await page.getByRole('button', { name: 'Import from Pathbuilder' }).click();
  await expect(page.locator('#import-dialog')).toBeVisible();
}

test('takes a JSON export, shows what would change, and applies it', async ({ page }) => {
  await openImport(page);

  await page.locator('#pb-file').setInputFiles(EXPORT);

  // The diff, not the sheet: nothing is written until it is accepted.
  const diff = page.locator('.diff');
  await expect(diff).toBeVisible();
  await expect(diff.locator('input[type=checkbox]').first()).toBeChecked();
  await expect(page.locator('#import-body')).toContainText('would change');

  await page.locator('#import-confirm').click();
  await expect(page.locator('#import-dialog')).toBeHidden();

  await expect(page.locator('#character-name')).toHaveText(/Kestrel Vane/);
});

test('leaves alone anything the player unchecks', async ({ page, request }) => {
  // A character of its own: the test above applied an import, and a sheet that
  // already matches has nothing left to offer this one.
  const { token } = await table.addCharacter(request, 'Unchecked');
  await openImport(page, token);
  await page.locator('#pb-file').setInputFiles(EXPORT);

  const rows = page.locator('.diff label');
  await expect(rows.first()).toBeVisible();

  // Uncheck every row: applying should then change nothing at all.
  for (const box of await page.locator('.diff input[type=checkbox]').all()) await box.uncheck();
  await page.locator('#import-confirm').click();
  await expect(page.locator('#import-dialog')).toBeHidden();

  await openImport(page, token);
  await page.locator('#pb-file').setInputFiles(EXPORT);
  // The same fields are still outstanding, because none of them were written.
  await expect(page.locator('#import-body')).toContainText('would change');
});

test('says so when the file is not JSON', async ({ page }) => {
  await openImport(page);
  await page.locator('#pb-file').setInputFiles({
    name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('this is not a build'),
  });
  await expect(page.locator('#import-body')).toContainText('not readable JSON');
});

/**
 * The build the import reconstructs.
 *
 * An import used to write a sheet and leave the builder empty, so an imported
 * character and a built one were two different kinds of thing that the
 * application disagreed about. The file is now read a second way -- as the
 * choices that would have produced it -- and the character can be levelled up
 * afterwards like any other.
 */
test.describe('the builder, filled in from the file', () => {
  test('says what it worked out, and fills the builder in', async ({ page, request }) => {
    const { token } = await table.addCharacter(request, 'Reconstructed');
    await openImport(page, token);
    await page.locator('#pb-file').setInputFiles(EXPORT);

    const card = page.locator('.import-builder');
    await expect(card).toContainText('Also fill in the character builder');
    // The four choices it resolved out of the catalogue, by name.
    await expect(card).toContainText('Human');
    await expect(card).toContainText('Fighter');
    await expect(card).toContainText('Level 5');
    await expect(page.locator('#import-build')).toBeChecked();

    await page.locator('#import-confirm').click();
    await expect(page.locator('#import-dialog')).toBeHidden();

    await page.goto(`/build/${token}`);
    await expect(page.locator('.slot-row', { hasText: 'Ancestry' }).first()).toContainText('Human');
    await expect(page.locator('.slot-row', { hasText: 'Class' }).first()).toContainText('Fighter');
    await expect(page.locator('#summary')).toContainText('Fighter');
  });

  test('leaves the builder alone when the player unticks it', async ({ page, request }) => {
    const { token } = await table.addCharacter(request, 'Sheet only');
    await openImport(page, token);
    await page.locator('#pb-file').setInputFiles(EXPORT);

    await page.locator('#import-build').uncheck();
    await page.locator('#import-confirm').click();
    await expect(page.locator('#import-dialog')).toBeHidden();

    // The sheet took the file's values...
    await expect(page.locator('#character-name')).toHaveText(/Kestrel Vane/);
    // ...and nothing was chosen on their behalf.
    await page.goto(`/build/${token}`);
    await expect(page.locator('.slot-row', { hasText: 'Ancestry' }).first())
      .toContainText('Choose');
  });

  test('a character imported with their build survives the builder', async ({ page, request }) => {
    const { token } = await table.addCharacter(request, 'Levelling up');
    await openImport(page, token);
    await page.locator('#pb-file').setInputFiles(EXPORT);
    await page.locator('#import-confirm').click();
    await expect(page.locator('#import-dialog')).toBeHidden();

    // The thing that used to cost an import everything it had.
    await page.goto(`/build/${token}`);
    await page.locator('#coins-gp').click();

    await page.goto(`/c/${token}`);
    await page.locator('.sheet-tabs').getByRole('button', { name: 'Character', exact: true }).click();
    await expect(page.locator('#character-name')).toHaveText(/Kestrel Vane/);
  });
});
