import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const html = readFileSync('./dist/loop-console-artifact.html', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

// Wrap exactly the way the artifact host does.
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`,
  { waitUntil: 'networkidle' });

const check = (label, cond, extra = '') =>
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);

// --- structure -------------------------------------------------------------
check('component upgraded', await page.locator('loop-console .ogl-shell').count() === 1);
check('nine slots rendered', await page.locator('.ogl-slot').count() === 9);
check('four fault cards', await page.locator('.ogl-fault').count() === 4);
check('four stat blocks', await page.locator('details.ogl-det').count() === 4);
check('no nested buttons', await page.locator('button button').count() === 0);
check('no inline style attributes', await page.locator('loop-console [style]').count() === 0);

// --- clock -----------------------------------------------------------------
const slotNow = () => page.locator('.ogl-slot.is-now .ogl-slot-n').innerText();
check('starts on slot 1', (await slotNow()) === '1');
await page.locator('loop-console').focus();
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
check('arrow keys advance', (await slotNow()) === '3', 'now ' + await slotNow());
await page.keyboard.press('ArrowLeft');
check('arrow keys rewind', (await slotNow()) === '2');

// slot 7 event note
for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
check('slot 7 fires the aspic', (await page.locator('.ogl-eventnote').innerText()).includes('aspic'));

// clamps at 9
for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
check('clock clamps at 9', (await slotNow()) === '9');

// --- faults: the persist/reset split, which is the whole point -------------
const known = page.locator('.ogl-fault').first().locator('.ogl-pill--known');
const fixed = page.locator('.ogl-fault').first().locator('.ogl-pill--fixed');
await fixed.click();
check('fixing implies known', await known.getAttribute('aria-pressed') === 'true');
check('fixed is set', await fixed.getAttribute('aria-pressed') === 'true');

// --- influence -------------------------------------------------------------
const plus = page.locator('.ogl-step button').nth(1);
for (let i = 0; i < 4; i++) await plus.click();
check('influence counts', (await page.locator('.ogl-inf-pts').innerText()) === '4');
check('thresholds light', await page.locator('.ogl-rung.is-hit').count() === 2,
  (await page.locator('.ogl-rung.is-hit').count()) + ' hit');
check('high-water shown', (await page.locator('.ogl-inf-hw').innerText()).includes('best 4'));

// --- the reset: fixed resets, known and high-water persist -----------------
await page.keyboard.press('r');
check('loop incremented', (await page.locator('.ogl-loopcount b').innerText()) === '2');
check('reset returns to slot 1', (await slotNow()) === '1');
check('fixed CLEARED by reset', await fixed.getAttribute('aria-pressed') === 'false');
check('known PERSISTS through reset', await known.getAttribute('aria-pressed') === 'true');
check('influence points cleared', (await page.locator('.ogl-inf-pts').innerText()) === '0');
check('high-water persists', (await page.locator('.ogl-inf-hw').innerText()).includes('best 4'));
check('earned thresholds still marked', await page.locator('.ogl-rung.is-earned').count() === 2);

// --- undo ------------------------------------------------------------------
await page.keyboard.press('u');
check('undo restores loop', (await page.locator('.ogl-loopcount b').innerText()) === '1');
check('undo restores fixed', await fixed.getAttribute('aria-pressed') === 'true');

// --- sticky solve survives a reset ----------------------------------------
const aspic = page.locator('.ogl-fault').nth(2);
await aspic.locator('.ogl-fault-toggle').click();
await aspic.locator('.ogl-chip', { hasText: 'Solved permanently' }).click();
await page.keyboard.press('r');
check('sticky solve survives the burn',
  await aspic.locator('.ogl-pill--fixed').getAttribute('aria-pressed') === 'true');

// --- perfect run banner ----------------------------------------------------
// Assert it starts HIDDEN first. Only checking that it appears is a vacuous
// test: a banner that is always visible passes it.
check('perfect banner hidden while faults remain',
  !(await page.locator('.ogl-perfect').isVisible()));
for (const i of [0, 1, 3]) {
  const f = page.locator('.ogl-fault').nth(i).locator('.ogl-pill--fixed');
  if (await f.getAttribute('aria-pressed') !== 'true') await f.click();
}
check('perfect-run banner appears', await page.locator('.ogl-perfect').isVisible());

// --- themes ----------------------------------------------------------------
const contrastOK = async () => {
  const c = await page.evaluate(() => {
    const n = document.querySelector('loop-console');
    const s = getComputedStyle(n);
    return { bg: s.backgroundColor, fg: s.color };
  });
  return c.bg !== c.fg && c.bg !== 'rgba(0, 0, 0, 0)';
};
check('dark theme paints a ground', await contrastOK());
await page.emulateMedia({ colorScheme: 'light' });
check('light theme paints a ground', await contrastOK());
const lightTokens = await page.evaluate(() =>
  getComputedStyle(document.querySelector('loop-console')).backgroundColor);
check('light theme actually differs', lightTokens === 'rgb(246, 244, 252)', lightTokens);

// --- host token inheritance ------------------------------------------------
await page.emulateMedia({ colorScheme: 'dark' });
await page.evaluate(() => document.documentElement.style.setProperty('--og-primary', '#00ff00'));
const inherited = await page.evaluate(() =>
  getComputedStyle(document.querySelector('loop-console')).getPropertyValue('--ogl-primary').trim());
check('inherits host --og-* tokens', inherited === '#00ff00', inherited);

// --- accessibility ---------------------------------------------------------
const unlabeled = await page.evaluate(() =>
  [...document.querySelectorAll('loop-console button')]
    .filter(b => !b.textContent.trim() && !b.getAttribute('aria-label')).length);
check('every button has an accessible name', unlabeled === 0, unlabeled + ' unlabeled');
check('live region present', await page.locator('[role="status"][aria-live="polite"]').count() === 1);

// --- no horizontal body scroll --------------------------------------------
await page.setViewportSize({ width: 390, height: 800 });
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('no horizontal page scroll at 390px', overflow <= 0, overflow + 'px');

console.log('\n' + (errors.length ? 'RUNTIME ERRORS:\n' + errors.join('\n') : 'No console or page errors.'));
await browser.close();
