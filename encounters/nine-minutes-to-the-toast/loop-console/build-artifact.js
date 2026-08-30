#!/usr/bin/env node
/**
 * Inline the module sources into a single self-contained page for the
 * hosted artifact. One codebase, two outputs — the artifact never drifts
 * from the module Off-Guard will actually import.
 *
 *   node build-artifact.js  ->  dist/loop-console-artifact.html
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, 'src', f), 'utf8');

// Strip module syntax: an inline <script type="module"> has no importer, so
// the export keywords and the cross-file import are both meaningless here.
const stripModule = (code) =>
  code
    .replace(/^export\s+(?=(const|function|class)\s)/gm, '')
    .replace(/^import\s+.*?;\s*$/gms, '');

const css = src('loop-console.css');
const data = stripModule(src('nine-minutes.data.js'));
const comp = stripModule(src('loop-console.js'));

const html = `<title>Nine Minutes Loop Console</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600&display=swap">
<style>
/* The artifact host paints its own ground behind the page, so the wrapper
   must set an explicit background or it borrows the host's theme. */
html, body { background: #1A1033; }
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) html,
  :root:not([data-theme="dark"]) body { background: #F6F4FC; }
}
:root[data-theme="light"] html,
:root[data-theme="light"] body { background: #F6F4FC; }
body { margin: 0; min-height: 100vh; }

${css}
</style>

<loop-console id="console"></loop-console>

<script type="module">
${data}

${comp}

const node = document.getElementById('console');
node.adventure = ADVENTURE;
node.storage = localAdapter('off-guard:loop:' + ADVENTURE.id);
node.focus();
</script>
`;

mkdirSync(join(here, 'dist'), { recursive: true });
const out = join(here, 'dist', 'loop-console-artifact.html');
writeFileSync(out, html);
console.log('wrote %s (%d KB)', out, Math.round(html.length / 1024));
