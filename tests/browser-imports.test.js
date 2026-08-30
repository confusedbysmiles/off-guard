/**
 * Every module the browser is asked to fetch actually exists.
 *
 * `node --check` parses a file without resolving its imports, and the server
 * has no build step to fail, so a relative import with the wrong number of
 * `../` in it is syntactically perfect, passes every unit test, and 404s in the
 * browser — taking the whole page down, because one failed module in a graph
 * loads none of it.
 *
 * That is not hypothetical. Adding one import to four files put
 * `../../../engine/...` in `gm/views/`, which is one level deeper than the
 * modules beside it, and the dashboard rendered nothing at all.
 *
 * `/engine/rules/` and `/engine/shared/` are mounted from `src/`, which is the
 * one mapping this has to know about: the rules engine is served to the browser
 * as the same files the server imports, so there is one copy of the arithmetic.
 *
 * The parse check is here for the same reason: nothing compiles this code, so a
 * file that does not parse is found by loading the page, and the page it breaks
 * is every page that imports it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});

const modules = walk(join(PUBLIC, 'assets/js')).filter((f) => f.endsWith('.js'));

/** Where a URL path the browser would request lands on disk. */
function onDisk(urlPath) {
  if (urlPath.startsWith('/engine/rules/')) {
    return join(ROOT, 'src/rules', urlPath.slice('/engine/rules/'.length));
  }
  if (urlPath.startsWith('/engine/shared/')) {
    return join(ROOT, 'src/shared', urlPath.slice('/engine/shared/'.length));
  }
  return join(PUBLIC, urlPath.replace(/^\//, ''));
}

/**
 * The URL a page would resolve this import against.
 *
 * Every page is exactly two segments deep — `<mount>/gm/<token>` — which is what
 * makes the application work at a host root and in a subdirectory without any
 * client configuration. So a module at `assets/js/gm/views/x.js` is fetched
 * from a document at depth 2, and its own relative imports resolve against its
 * own URL, not the document's.
 */
const urlOf = (file) => `/${relative(PUBLIC, file).split('\\').join('/')}`;

describe('relative imports in the browser bundle', () => {
  it('has modules to check', () => {
    expect(modules.length).toBeGreaterThan(15);
  });

  it.each(modules.map((f) => [relative(PUBLIC, f), f]))('%s resolves every import', (_name, file) => {
    const source = readFileSync(file, 'utf8');
    const specifiers = [
      ...source.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s+['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map(([, specifier]) => specifier);

    for (const specifier of specifiers) {
      // A bare specifier would need an import map, and there is none: the
      // browser gets no dependencies at all.
      expect(specifier.startsWith('.') || specifier.startsWith('/'),
        `${specifier} is a bare specifier, and nothing serves those`).toBe(true);

      // URL semantics, not path semantics: the browser resolves this against
      // the module's own URL.
      const target = onDisk(new URL(specifier, `http://x${urlOf(file)}`).pathname);

      expect(existsSync(target) && statSync(target).isFile(),
        `${relative(PUBLIC, file)} imports ${specifier}, which is not served`).toBe(true);
    }
  });
});

describe('every browser module', () => {
  it('parses', () => {
    // One subprocess for all of them, not one each. `node --check` per file
    // meant thirty-odd spawns from a suite that runs its files in parallel,
    // and the contention made unrelated tests fail at random -- a flaky suite
    // is worth less than no suite. `SourceTextModule` parses without
    // evaluating, which is the whole point: these touch the DOM on import.
    const script = `
      const vm = require('vm');
      const { readFileSync } = require('fs');
      const bad = [];
      for (const file of process.argv.slice(1)) {
        try { new vm.SourceTextModule(readFileSync(file, 'utf8')); }
        catch (error) { bad.push(file + ': ' + error.message); }
      }
      if (bad.length) { console.error(bad.join('\\n')); process.exit(1); }
    `;
    const result = spawnSync(
      'node',
      ['--experimental-vm-modules', '--no-warnings', '-e', script, '--', ...modules],
      { encoding: 'utf8' },
    );
    expect(result.stderr.trim(), result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});

describe('what the HTML asks for', () => {
  const pages = readdirSync(PUBLIC).filter((f) => f.endsWith('.html'));

  it.each(pages)('%s links only to files that exist', (page) => {
    const source = readFileSync(join(PUBLIC, page), 'utf8');
    const refs = [...source.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map(([, ref]) => ref)
      .filter((ref) => !/^(https?:|data:|mailto:|#)/.test(ref));

    expect(refs.length).toBeGreaterThan(2);
    for (const ref of refs) {
      // Pages sit two segments deep, so every reference has to be relative and
      // climb: a root-absolute one works at a host root and 404s the moment the
      // application moves to a subdirectory.
      expect(ref.startsWith('/'), `${page} has a root-absolute reference: ${ref}`).toBe(false);
      // Against the document's own URL, which is two segments deep.
      const target = onDisk(new URL(ref, 'http://x/gm/token').pathname);
      expect(existsSync(target), `${page} references ${ref}, which is not there`).toBe(true);
    }
  });
});
