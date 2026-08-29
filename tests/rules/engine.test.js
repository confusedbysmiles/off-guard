/**
 * The engine's contract with the rest of the application.
 */
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as engine from '../../src/rules/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

describe('the engine runs anywhere', () => {
  const files = sourceFiles(join(ROOT, 'src/rules'));

  it('imports nothing from node:, and nothing outside src/', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map(([, s]) => s);
      for (const specifier of imports) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/^node:/);
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/tools\//);
        expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.\.?\//);
      }
    }
  });

  it('imports no package, so the browser can load it directly', () => {
    // The application has dependencies; the rules engine must not reach any of
    // them. Every specifier above is relative, which is the assertion -- this
    // one guards against a bare specifier being added to a *new* file.
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const packages = Object.keys(pkg.dependencies ?? {});
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const name of packages) {
        expect(source, `${file} imports ${name}`).not.toMatch(
          new RegExp(`from\\s+'${name.replace(/[/@]/g, '\\$&')}`),
        );
      }
    }
  });
});

describe('the public surface', () => {
  it('exports everything the application needs', () => {
    for (const name of [
      'adjustCreature', 'scaleCreature', 'describeScaling',
      'priceEncounter', 'repriceEncounter', 'budgetFor', 'creatureCost', 'difficultyOf',
      'dcByLevel', 'degreeOfSuccess', 'simpleDc',
      'recallKnowledge', 'skillsFor',
      'statistic', 'armorClass', 'classDc', 'proficiencyBonus',
    ]) {
      expect(engine[name], name).toBeTypeOf('function');
    }
  });
});
