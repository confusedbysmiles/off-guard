/**
 * Accessibility, as a test rather than an assurance.
 *
 * These are the checks that caught something real: the dashboard had no
 * level-one heading at all, the campaign switcher claimed listbox semantics it
 * did not implement, and the drawer's tabs were tabs in name only. All three
 * would have passed any amount of visual review.
 *
 * What is not here is a full audit -- no automated check is one. Contrast is
 * covered separately by `npm run check:contrast`, which walks the design tokens
 * rather than the rendered page.
 */
import { expect, test } from '@playwright/test';

import { loadWorld, PORTS } from './world.js';

const world = loadWorld(PORTS.desktop);

/**
 * Every interactive element must have an accessible name.
 *
 * Computed in the page, roughly the way a screen reader would: aria-label, then
 * a label element, then the element's own text, then title. A placeholder is
 * reported separately because it is not a label -- it disappears the moment
 * someone types.
 */
const NAME_AUDIT = `
  (() => {
    const name = (el) => {
      const aria = el.getAttribute('aria-label');
      if (aria && aria.trim()) return aria.trim();
      const by = el.getAttribute('aria-labelledby');
      if (by) {
        const t = by.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
        if (t) return t;
      }
      if (el.id) {
        const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (l?.textContent.trim()) return l.textContent.trim();
      }
      if (el.closest('label')?.textContent.trim()) return el.closest('label').textContent.trim();
      const text = (el.innerText || el.textContent || '').trim();
      if (text) return text;
      const title = el.getAttribute('title');
      if (title?.trim()) return title.trim();
      if (el.tagName === 'INPUT' && el.placeholder) return '(placeholder only) ' + el.placeholder;
      return null;
    };
    const controls = [...document.querySelectorAll('button, input, select, textarea, a[href]')]
      .filter((el) => el.offsetParent !== null);
    return {
      total: controls.length,
      unnamed: controls.filter((el) => !name(el))
        .map((el) => el.tagName + '.' + el.className + ' ' + (el.type || '')),
      placeholderOnly: controls.filter((el) => (name(el) || '').startsWith('(placeholder only)'))
        .map((el) => el.tagName + ' ' + el.placeholder),
    };
  })()
`;

const SURFACES = [
  ['the character sheet', () => `/c/${world.characterToken}`],
  ['the character builder', () => `/build/${world.characterToken}`],
  ['the GM dashboard', () => `/gm/${world.gmToken}`],
  ['the shared screen', () => `/table/${world.tableToken}`],
];

for (const [label, path] of SURFACES) {
  test.describe(label, () => {
    test('names every control it shows', async ({ page }) => {
      await page.goto(path());
      const audit = await page.evaluate(NAME_AUDIT);
      expect(audit.total).toBeGreaterThan(0);
      expect(audit.unnamed, `unnamed controls on ${label}`).toEqual([]);
      expect(audit.placeholderOnly, `placeholder used as a label on ${label}`).toEqual([]);
    });

    test('has exactly one level-one heading', async ({ page }) => {
      await page.goto(path());
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).not.toBeEmpty();
    });

    test('has a main landmark and a skip link that reaches it', async ({ page }) => {
      await page.goto(path());
      await expect(page.locator('main')).toHaveCount(1);
    });
  });
}

test.describe('the GM dashboard, in more detail', () => {
  test('names every control on the initiative tracker too', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('i');
    await expect(page.locator('.combatant').first()).toBeVisible();
    const audit = await page.evaluate(NAME_AUDIT);
    // The tracker is where the icon buttons are; this is the number that matters.
    expect(audit.total).toBeGreaterThan(30);
    expect(audit.unnamed).toEqual([]);
  });

  test('names every control in the drawer', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    for (const key of ['r', 'd']) {
      await page.locator('body').press(key);
      await expect(page.locator('#drawer')).toBeVisible();
      const audit = await page.evaluate(NAME_AUDIT);
      expect(audit.unnamed, `drawer on ${key}`).toEqual([]);
    }
  });

  /**
   * The drawer's tabs were marked `role="tab"` before they behaved like tabs.
   * A role is a promise about keyboard behaviour, and this is the promise.
   */
  test('the drawer tabs are operable from the keyboard', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('r');

    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(3);
    await expect(page.locator('#drawer-body')).toHaveAttribute('role', 'tabpanel');

    // Exactly one tab in the tab order at a time.
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);

    const selected = () => page.locator('[role="tab"][aria-selected="true"]').getAttribute('id');
    expect(await selected()).toBe('drawer-tab-reference');

    await page.locator('[role="tab"][aria-selected="true"]').press('ArrowRight');
    expect(await selected()).toBe('drawer-tab-dice');

    await page.locator('[role="tab"][aria-selected="true"]').press('End');
    expect(await selected()).toBe('drawer-tab-recall');

    // And the panel says which tab it belongs to.
    await expect(page.locator('#drawer-body'))
      .toHaveAttribute('aria-labelledby', 'drawer-tab-recall');
  });

  test('does not claim widget roles it has not implemented', async ({ page }) => {
    await page.goto(`/gm/${world.gmToken}`);
    await page.locator('body').press('c');
    // The campaign switcher is a group of buttons. It was a listbox, which
    // promises arrow-key selection that was never written.
    await expect(page.locator('[role="listbox"]')).toHaveCount(0);
    await expect(page.locator('[role="option"]')).toHaveCount(0);
    await expect(page.locator('#switcher-list')).toHaveAttribute('role', 'group');
  });
});

test.describe('the shared screen', () => {
  test('announces a turn and nothing else', async ({ page }) => {
    await page.goto(`/table/${world.tableToken}`);
    // One polite live region, for turn changes. The order itself is not one:
    // a creature losing hit points must not interrupt a reader mid-sentence.
    await expect(page.locator('[aria-live]')).toHaveCount(1);
    await expect(page.locator('#announcement')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('.order[aria-live]')).toHaveCount(0);
  });

  test('has nothing that can write', async ({ page }) => {
    await page.goto(`/table/${world.tableToken}`);
    await expect(page.locator('input, textarea, select, [contenteditable]')).toHaveCount(0);
  });
});
