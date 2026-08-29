#!/usr/bin/env node
/**
 * `npm run build:fonts`
 *
 * Downloads Jost and writes it into `public/assets/fonts/`, once, at build
 * time. The result is committed: nothing in this application reaches the
 * network at runtime, and a fresh clone must render correctly offline.
 *
 * Jost is licensed under the SIL Open Font License 1.1, which requires the
 * licence to travel with the font. It is fetched alongside the files.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PROJECT_ROOT } from '../build-data/upstream.js';

const OUT = resolve(PROJECT_ROOT, 'public/assets/fonts');

// Asking as a modern browser is what makes Google Fonts serve woff2 and the
// variable font rather than a pile of static weights.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  + ' (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CSS_URL = 'https://fonts.googleapis.com/css2?family=Jost:ital,wght@0,300..700;1,300..700&display=swap';
const LICENSE_URL = 'https://raw.githubusercontent.com/indestructible-type/Jost/master/OFL.txt';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const css = await fetchText(CSS_URL);
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => body);

  const written = [];
  for (const body of faces) {
    const url = /src:\s*url\(([^)]+)\)/.exec(body)?.[1];
    const style = /font-style:\s*([^;]+);/.exec(body)?.[1].trim() ?? 'normal';
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(body)?.[1].trim() ?? null;
    if (!url) continue;

    // Latin only. The other subsets are real coverage, but this is a private
    // application for one table and every extra file is bytes on a phone at a
    // pub with two bars of signal.
    if (unicodeRange && !unicodeRange.includes('U+0000-00FF')) continue;

    const name = `jost-${style === 'italic' ? 'italic' : 'normal'}.woff2`;
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    writeFileSync(resolve(OUT, name), bytes);
    written.push([name, bytes.length, style]);
  }

  const license = await fetchText(LICENSE_URL);
  writeFileSync(resolve(OUT, 'OFL.txt'), license);

  for (const [name, size, style] of written) {
    console.log(`  ${name.padEnd(24)} ${(size / 1024).toFixed(1)} KB  ${style}`);
  }
  console.log(`  OFL.txt`);
  console.log('Fonts written to public/assets/fonts/. Commit them.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
