import { describe, expect, it } from 'vitest';

import {
  adjustDamageParts, adjustFormulaFlat, parseDamageExpression, renderDamageParts,
} from '../src/shared/damage-expression.js';
import {
  createMarkupResolver, htmlToText, normalizeParagraphs, renderCheck, sanitizeHtml,
} from '../tools/build-data/markup.js';
import { createFixtureResolver } from './fixtures/index.js';

describe('damage expressions', () => {
  it('parses a single typed term', () => {
    const { parts } = parseDamageExpression('2d6[poison]');
    expect(parts).toEqual([
      { formula: '2d6', types: ['poison'], persistent: false, category: null },
    ]);
  });

  it('splits top-level terms but not the type list', () => {
    const { parts } = parseDamageExpression('(2d6+3)[slashing],1d6[persistent,fire]');
    expect(parts).toHaveLength(2);
    expect(parts[0].formula).toBe('2d6+3');
    expect(parts[1]).toMatchObject({ formula: '1d6', types: ['fire'], persistent: true });
    expect(renderDamageParts(parts)).toBe('2d6+3 slashing plus 1d6 persistent fire');
  });

  it('keeps splash and precision as categories, not damage types', () => {
    const { parts } = parseDamageExpression('1d6[precision]');
    expect(parts[0]).toMatchObject({ types: [], category: 'precision' });
  });

  it('reads pipe-separated options', () => {
    const { options } = parseDamageExpression('(@item.rank+1)d8[acid]|options:area-damage');
    expect(options).toEqual({ options: 'area-damage' });
  });

  describe('flat adjustment', () => {
    it('folds into an existing constant', () => {
      expect(adjustFormulaFlat('2d6+3', 2)).toBe('2d6+5');
      expect(adjustFormulaFlat('2d6+3', -2)).toBe('2d6+1');
    });

    it('adds a constant when there is none', () => {
      expect(adjustFormulaFlat('2d6', 2)).toBe('2d6+2');
      expect(adjustFormulaFlat('2d6', -4)).toBe('2d6-4');
    });

    it('drops a constant that cancels out', () => {
      expect(adjustFormulaFlat('1d6+2', -2)).toBe('1d6');
    });

    it('treats a bare number as a number', () => {
      expect(adjustFormulaFlat('5', 2)).toBe('7');
    });

    it('refuses to guess at an unresolved runtime reference', () => {
      expect(adjustFormulaFlat('(@item.level)d4', 2)).toBe('(@item.level)d4');
    });

    it('applies across every part', () => {
      const { parts } = parseDamageExpression('(2d6+3)[slashing],1d6[fire]');
      expect(renderDamageParts(adjustDamageParts(parts, 2)))
        .toBe('2d6+5 slashing plus 1d6+2 fire');
    });
  });
});

describe('sanitizer', () => {
  it('drops tags outside the allowlist but keeps their text', () => {
    expect(sanitizeHtml('<div onclick="x()">hi</div>').html).toBe('hi');
  });

  it('strips attributes', () => {
    expect(sanitizeHtml('<p class="foo" style="color:red">a</p>').html).toBe('<p>a</p>');
  });

  it('preserves GM-only markers as a class', () => {
    const { html, gmOnly } = sanitizeHtml('<span data-visibility="gm">secret</span>');
    expect(html).toBe('<span class="og-gm-only">secret</span>');
    expect(gmOnly).toBe(true);
  });

  it('normalizes self-closing hr', () => {
    expect(sanitizeHtml('<hr />').html).toBe('<hr>');
  });
});

describe('paragraph normalization', () => {
  it('closes an open paragraph before a nested block', () => {
    expect(normalizeParagraphs('<p>a<p>b</p></p>')).toBe('<p>a</p><p>b</p>');
  });

  it('closes a paragraph before an hr', () => {
    expect(normalizeParagraphs('<p>a<hr>b')).toBe('<p>a</p><hr>b');
  });

  it('drops empty paragraphs', () => {
    expect(normalizeParagraphs('<p></p><p>a</p>')).toBe('<p>a</p>');
  });
});

describe('checks', () => {
  it('renders a basic save', () => {
    expect(renderCheck({ statistic: 'reflex', dc: 29, basic: true, name: null }))
      .toBe('DC 29 basic Reflex save');
  });

  it('renders a flat check', () => {
    expect(renderCheck({ statistic: 'flat', dc: 15, basic: false, name: null }))
      .toBe('DC 15 flat check');
  });

  it('renders a named skill check', () => {
    expect(renderCheck({ statistic: 'thievery', dc: 12, basic: false, name: 'Remove the Trapdoor' }))
      .toBe('DC 12 Thievery (Remove the Trapdoor)');
  });
});

describe('resolver', () => {
  const { resolve } = createMarkupResolver({
    uuidIndex: new Map([
      ['conditionitems:frightened', { kind: 'condition', id: 'frightened', name: 'Frightened' }],
      ['conditionitems:kWc1fhmv9LBiTuei', { kind: 'condition', id: 'grabbed', name: 'Grabbed' }],
    ]),
    glossary: new Map([
      ['PF2E.Test.Nested', '<p>Glossary text with @UUID[Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei].</p>'],
    ]),
  });

  it('resolves a UUID by name', () => {
    const out = resolve('<p>@UUID[Compendium.pf2e.conditionitems.Item.Frightened]{Frightened 1}</p>');
    expect(out.html).toContain('href="#/ref/condition/frightened"');
    expect(out.text).toBe('Frightened 1');
  });

  it('resolves a UUID by id, which is what the glossary strings use', () => {
    const out = resolve('<p>@Localize[PF2E.Test.Nested]</p>');
    expect(out.html).toContain('href="#/ref/condition/grabbed"');
    expect(out.text).toBe('Glossary text with Grabbed.');
  });

  it('marks an unresolvable reference instead of dropping the label', () => {
    const out = resolve('<p>@UUID[Compendium.pf2e.nowhere.Item.Nothing]{Nothing}</p>');
    expect(out.html).toContain('og-ref--unresolved');
    expect(out.text).toBe('Nothing');
    expect(out.unresolved).toHaveLength(1);
  });

  it('substitutes runtime references from the actor context', () => {
    const out = resolve('<p>@Damage[(@item.rank+1)d8[acid]]</p>', { level: 5, rank: 3 });
    expect(out.text).toBe('4d8 acid');
    expect(out.damage[0].parts[0].formula).toBe('4d8');
  });

  it('leaves a runtime reference symbolic when the context cannot resolve it', () => {
    const out = resolve('<p>@Damage[(@item.rank)d4[persistent,fire]]</p>', { level: 5 });
    expect(out.damage[0].parts[0].formula).toBe('(@item.rank)d4');
  });

  it('indexes damage and checks so a transform can rewrite them in place', () => {
    const out = resolve('<p>@Damage[2d6[fire]] and @Check[reflex|dc:20|basic]</p>', { level: 1 });
    expect(out.html).toContain('data-og-dmg="0"');
    expect(out.html).toContain('data-og-chk="0"');
    expect(out.checks[0]).toMatchObject({ statistic: 'reflex', dc: 20, basic: true });
  });

  it('renders a template as distance and shape', () => {
    expect(resolve('<p>@Template[emanation|distance:30]</p>').text).toBe('30-foot emanation');
  });

  // Both spellings ship in current packs; the legacy one used to leak
  // `type:cone` onto the stat block.
  it('renders the legacy keyed template shape', () => {
    expect(resolve('<p>@Template[type:cone|distance:60]</p>').text).toBe('60-foot cone');
    expect(resolve('<p>@Template[type:emanation|distance:10]</p>').text).toBe('10-foot emanation');
  });

  it('does not double the word save when the prose already supplies it', () => {
    expect(resolve('<p>a @Check[reflex|dc:41|basic] save)</p>').text)
      .toBe('a DC 41 basic Reflex save)');
    expect(resolve('<p>a @Check[will|dc:39] saving throw.</p>').text)
      .toBe('a DC 39 Will save.');
    // A check that does not end in "save" leaves following prose alone.
    expect(resolve('<p>a @Check[flat|dc:15] check</p>').text)
      .toBe('a DC 15 flat check check');
  });

  it('renders inline rolls with their flavor', () => {
    expect(resolve('<p>[[/gmr 1d4 #Recharge]]</p>').text).toBe('1d4 (Recharge)');
    expect(resolve('<p>[[/br 2d4 #days]]{2d4 days}</p>').text).toBe('2d4 days');
  });

  it('resolves every @Localize reference in the fixture set', () => {
    const fixture = createFixtureResolver();
    const out = fixture.resolve('<p>@Localize[PF2E.NPC.Abilities.Glossary.Regeneration]</p>', { level: 5 });
    expect(out.unresolved).toEqual([]);
    expect(out.text).toMatch(/regains the listed number of Hit Points/);
  });
});

describe('htmlToText', () => {
  it('collapses markup and whitespace', () => {
    expect(htmlToText('<p>a</p><hr><p>b   c</p>')).toBe('a b c');
  });
});
