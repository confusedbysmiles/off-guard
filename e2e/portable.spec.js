/**
 * A character, out to a file and back in.
 *
 * The download is the part that has to run in a real browser: a blob URL and
 * an anchor click is the whole mechanism, and this application serves a
 * content security policy of `default-src 'none'`. Whether that policy lets a
 * download through is not a thing to reason about -- it is a thing to watch
 * happen, which is why this test waits for the browser's own download event
 * rather than for a button to change its label.
 */
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { sandbox } from './sandbox.js';
import { loadWorld, PORTS } from './world.js';

const world = loadWorld(PORTS.desktop);
const table = sandbox(world.gmToken, 'the portable spec');

let playerToken;

test.beforeAll(async ({ request }) => { ({ playerToken } = await table.create(request)); });
test.afterAll(async ({ request }) => { await table.archive(request); });

/**
 * Wait for what was typed to reach the server.
 *
 * The sheet debounces its saves, so a download taken straight after typing
 * exports the character as the server still believes them to be. Asked of the
 * server, because that is the copy the file is made from.
 */
async function savedName(page) {
  return page.evaluate(async () => {
    const res = await fetch(location.pathname.replace('/c/', '/api/c/'), {
      headers: { accept: 'application/json' },
    });
    return (await res.json()).character?.sheet?.name ?? null;
  });
}

/** The save and restore buttons live on the Character panel. */
async function characterTab(page, token = playerToken) {
  await page.goto(`/c/${token}`);
  // The panels are wired after the sheet arrives; clicking a tab before then
  // leaves Combat showing and every field on Character invisible.
  await expect(page.locator('#character-name')).not.toHaveText('Loading…');
  await page.locator('.sheet-tabs').getByRole('button', { name: 'Character', exact: true }).click();
  await expect(page.locator('#panel-character')).toBeVisible();
}

test('saves a character to a real file, named after them', async ({ page, request }) => {
  // A character per test. Sharing one meant the second test met a sheet the
  // first had already changed, which is how this suite has gone wrong before.
  const { token } = await table.addCharacter(request, 'To be saved');
  await characterTab(page, token);

  // Give them a name first, so the filename has something to be made of.
  await page.getByLabel('Character name', { exact: true }).fill('Kestrel Vane');
  await expect.poll(() => savedName(page), { timeout: 10_000 }).toBe('Kestrel Vane');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Save a copy/ }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^kestrel-vane-\d{4}-\d{2}-\d{2}\.json$/);

  const file = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(file.format).toBe('off-guard-character');
  expect(file.character.sheet.name).toBe('Kestrel Vane');
  // The one thing it must never carry.
  expect(JSON.stringify(file)).not.toContain(token);
});

test('restores that file over a character who has drifted', async ({ page, request }) => {
  const { token } = await table.addCharacter(request, 'To drift');
  await characterTab(page, token);
  await page.getByLabel('Character name', { exact: true }).fill('Before the save');
  await expect.poll(() => savedName(page), { timeout: 10_000 }).toBe('Before the save');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Save a copy/ }).click(),
  ]);
  const saved = await download.path();

  await page.getByLabel('Character name', { exact: true }).fill('After the save');
  await expect.poll(() => savedName(page), { timeout: 10_000 }).toBe('After the save');

  await page.getByRole('button', { name: /Import or restore/ }).click();
  await expect(page.locator('#import-dialog')).toBeVisible();
  await page.locator('#pb-file').setInputFiles(saved);

  // Its own file, so the builder card says restore rather than fill in.
  const card = page.locator('.import-builder');
  if (await card.locator('#import-build').count()) {
    await expect(card).toContainText('Restore the character builder too');
  }

  await expect(page.locator('#import-body')).toContainText('would change');
  await page.locator('#import-confirm').click();
  await expect(page.locator('#import-dialog')).toBeHidden();

  await expect(page.locator('#character-name')).toHaveText(/Before the save/);
});

test('says plainly when the file is from a newer Off-Guard', async ({ page, request }) => {
  const { token } = await table.addCharacter(request, 'From the future');
  await characterTab(page, token);

  await page.getByRole('button', { name: /Import or restore/ }).click();
  await page.locator('#pb-file').setInputFiles({
    name: 'future.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      format: 'off-guard-character', version: 99, character: { sheet: {} },
    })),
  });

  await expect(page.locator('#import-body')).toContainText('newer Off-Guard');
});
