#!/usr/bin/env node
/**
 * `npm run check:contrast`
 *
 * Reads the tokens out of the stylesheet and checks every ink/ground pair the
 * interface actually uses against WCAG AA, in both themes. Accessibility is a
 * requirement rather than a pass at the end, and a palette that is checked by
 * eye on one monitor is not checked.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PROJECT_ROOT } from './build-data/upstream.js';

const CSS = readFileSync(resolve(PROJECT_ROOT, 'public/assets/css/tokens.css'), 'utf8');

/** Pull `--name: value;` out of one block. */
function block(selectorPattern) {
  const match = new RegExp(`${selectorPattern}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(CSS);
  if (!match) throw new Error(`No block matching ${selectorPattern}`);
  const tokens = {};
  for (const [, name, value] of match[1].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * Every pair the interface puts together, and the size it puts them at.
 * "large" is WCAG's 18.66px bold or 24px, which is the 3:1 threshold; anything
 * else is body text at 4.5:1. Non-text is 3:1.
 */
const PAIRS = [
  ['ink', 'bg', 4.5], ['ink', 'surface', 4.5], ['ink', 'surface-2', 4.5],
  ['ink-dim', 'bg', 4.5], ['ink-dim', 'surface', 4.5], ['ink-dim', 'surface-2', 4.5],
  ['ink-faint', 'bg', 3], ['ink-faint', 'surface', 3],
  ['primary-ink', 'bg', 4.5], ['primary-ink', 'surface', 4.5],
  ['accent-ink', 'bg', 4.5], ['accent-ink', 'surface', 4.5],
  ['good-ink', 'bg', 4.5], ['good-ink', 'surface', 4.5],
  ['warn-ink', 'bg', 4.5], ['warn-ink', 'surface', 4.5],
  ['bad-ink', 'bg', 4.5], ['bad-ink', 'surface', 4.5],
  ['border-strong', 'bg', 3], ['border-strong', 'surface', 3],
  ['focus', 'bg', 3], ['focus', 'surface', 3],
];

const DARK = block(':root');
const LIGHT = { ...DARK, ...block(":root\\[data-theme='light'\\]") };
/**
 * The system-preference block, which is a different block from the toggle's and
 * has to be checked separately: a palette that passes only when the toggle is
 * used is not a palette that passes.
 */
function mediaLightBlock() {
  for (const [, body] of CSS.matchAll(/@media \(prefers-color-scheme: light\)\s*\{([\s\S]*?)\n\}/g)) {
    if (!body.includes('--bg:')) continue;
    const tokens = {};
    for (const [, name, value] of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
      tokens[name] = value.trim();
    }
    return tokens;
  }
  throw new Error('No prefers-color-scheme: light block defining --bg');
}

const LIGHT_MEDIA = { ...DARK, ...mediaLightBlock() };

const themes = [['dark', DARK], ['light (toggle)', LIGHT], ['light (system)', LIGHT_MEDIA]];

let failed = 0;
for (const [name, tokens] of themes) {
  console.log(`\n${name}`);
  for (const [ink, ground, minimum] of PAIRS) {
    const a = tokens[ink];
    const b = tokens[ground];
    if (!a || !b || !a.startsWith('#') || !b.startsWith('#')) continue;
    const ratio = contrast(a, b);
    const ok = ratio >= minimum;
    if (!ok) failed += 1;
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'} ${ink} on ${ground}`.padEnd(42)
      + `${ratio.toFixed(2)}:1  needs ${minimum}:1`,
    );
  }
}

if (failed) {
  console.error(`\n${failed} pair(s) below WCAG AA.`);
  process.exit(1);
}
console.log('\nEvery pair meets WCAG AA.');
