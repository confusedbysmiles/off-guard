#!/usr/bin/env node
/**
 * `npm run build:reference`
 *
 * Builds `data/reference.json`: the tables and actions the reference drawer
 * shows.
 *
 * Checked in, unlike the creature catalogue. The drawer is the thing a GM opens
 * when a player asks what Demoralize does, and it should not be the part of the
 * application that stops working because a data build has not been run. It is
 * roughly a quarter of a megabyte, which is a fair trade for that.
 *
 * Two sources:
 *
 *   - The GM Screen journal, which is a transcription of printed GM Core and
 *     Player Core tables and carries a page citation per page.
 *   - The action items in `packs/pf2e/actions`, which carry the full printed
 *     text of each basic, skill, exploration and downtime action, along with
 *     its action cost and traits.
 *
 * Conditions are deliberately *not* here. They are already in the rules engine
 * at `src/rules/tables/conditions.js`, because the tracker applies them; the
 * drawer reads that same table so the text a GM reads and the text the tracker
 * acts on cannot drift apart.
 *
 * Everything goes through the same markup resolver the creature build uses, so
 * `@UUID[]` becomes a working `#/ref/...` link, `@Check[]` and `@Damage[]`
 * become readable text, and every attribute -- including the `style` the
 * journal uses for column alignment, which the Content-Security-Policy forbids
 * -- is stripped.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { ensureUpstream, LOCK, PROJECT_ROOT } from '../build-data/upstream.js';
import { buildUuidIndex } from '../build-data/uuid-index.js';
import { loadGlossary } from '../build-data/glossary.js';
import { createMarkupResolver, slugify } from '../build-data/markup.js';

const OUT = resolvePath(PROJECT_ROOT, 'data/reference.json');

/**
 * The journal pages worth having at a table, grouped the way a GM asks for
 * them. Everything else in the journal is a subsystem with its own chapter
 * (Chases, Duels, Influence) or a variant rule; both are reading material
 * rather than something looked up mid-turn, and neither is here.
 */
const JOURNAL_GROUPS = [
  ['dcs', 'Difficulty classes', [
    'Simple DCs',
    'DCs by Level',
    'DC Adjustments',
    'Specific Skill DCs',
    'Creature Identification',
  ]],
  ['building', 'Building encounters', [
    'Encounter Budget',
    'Monster Adjustments',
    'XP Awards',
    'Treasure',
    'Cost of Living',
    'Earn Income Tasks',
  ]],
  ['combat', 'In a fight', [
    'Bonuses and Penalties',
    'Death, Dying and Unconscious',
    'Hero Points',
    'Counteracting',
    'Size and Reach',
    'Terrain and Cover',
    'Falling',
    'Environmental Damage',
    'Structures and Force Open DCs',
  ]],
  ['perception', 'Seeing and hiding', [
    'Light',
    'Senses',
    'Detecting Creatures',
    'Detecting and Stealth with Other Senses',
  ]],
  ['downtime', 'Between fights', [
    'Treat Wounds',
    'Resting',
    'Exploration Activities',
    'Travel Speed',
    'Bulk and Encumbered',
    'Attitudes',
    'Weather Effects',
  ]],
];

/** Action packs, in the order the drawer lists them. */
const ACTION_GROUPS = [
  ['basic-actions', 'Basic actions', 'basic'],
  ['skill-actions', 'Skill actions', 'skill'],
  ['exploration-actions', 'Exploration', 'exploration'],
  ['downtime-actions', 'Downtime', 'downtime'],
];

/**
 * "Section: Running the Game Pathfinder GM Core pg. 53" -> the citation, and
 * the paragraph it came from, which the drawer renders as a footer rather than
 * as body text.
 */
function extractCitation(html) {
  const match = /<p>(?:(?!<p>)[\s\S])*?Pathfinder\s+(GM Core|Player Core|Monster Core|GM Core 2)\s*pg\.\s*(\d+)[\s\S]*?<\/p>\s*$/
    .exec(html);
  if (!match) return { html, citation: null };
  return {
    html: html.slice(0, match.index).trim(),
    citation: `${match[1]} pg. ${match[2]}`,
  };
}

function journalPages(upstream) {
  const file = resolvePath(upstream, 'packs/pf2e/journals/gm-screen.json');
  const journal = JSON.parse(readFileSync(file, 'utf8'));
  return new Map((journal.pages ?? []).map((p) => [p.name, p.text?.content ?? '']));
}

function buildJournalEntries(pages, resolve, report) {
  const entries = [];
  for (const [group, , names] of JOURNAL_GROUPS) {
    for (const name of names) {
      const raw = pages.get(name);
      if (raw === undefined) { report.missingPages.push(name); continue; }
      const resolved = resolve(raw, {});
      const { html, citation } = extractCitation(resolved.html);
      if (!citation) report.uncitedPages.push(name);
      entries.push({
        id: `table/${slugify(name)}`,
        kind: 'table',
        slug: slugify(name),
        name,
        group,
        html,
        text: resolved.text,
        citation,
        source: { title: null, license: 'ORC', page: null },
      });
    }
  }
  return entries;
}

/** `{ type: 'action', count: 2 }`, `{ type: 'reaction' }`, `{ type: 'passive' }`. */
function actionCost(system) {
  const type = system?.actionType?.value ?? 'passive';
  const count = system?.actions?.value ?? null;
  return count === null ? { type } : { type, count };
}

function buildActionEntries(upstream, resolve, report) {
  const entries = [];
  for (const [group, , pack] of ACTION_GROUPS) {
    const dir = resolvePath(upstream, 'packs/pf2e/actions', pack);
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      report.missingPacks.push(pack);
      continue;
    }
    for (const file of files) {
      const doc = JSON.parse(readFileSync(resolvePath(dir, file), 'utf8'));
      if (doc.type !== 'action') continue;
      const slug = file.replace(/\.json$/, '');
      const resolved = resolve(doc.system?.description?.value ?? '', {
        self: `action/${slug}`,
      });
      if (resolved.unresolved.length) {
        report.unresolvedLinks.push(...resolved.unresolved);
      }
      entries.push({
        id: `action/${slug}`,
        kind: 'action',
        slug,
        name: doc.name,
        group,
        cost: actionCost(doc.system),
        traits: doc.system?.traits?.value ?? [],
        html: resolved.html,
        text: resolved.text,
        citation: null,
        source: {
          title: doc.system?.publication?.title ?? null,
          license: doc.system?.publication?.license ?? null,
          // The publication block carries no page number, here as everywhere
          // else in the corpus. See tools/build-data/pages/README.md.
          page: null,
        },
      });
    }
  }
  return entries;
}

function main() {
  const upstream = ensureUpstream();
  const { index: uuidIndex } = buildUuidIndex(upstream);
  const glossary = loadGlossary(upstream);
  const { resolve } = createMarkupResolver({ uuidIndex, glossary });

  const report = {
    missingPages: [], uncitedPages: [], missingPacks: [], unresolvedLinks: [],
  };

  const entries = [
    ...buildJournalEntries(journalPages(upstream), resolve, report),
    ...buildActionEntries(upstream, resolve, report),
  ].sort((a, b) => a.id.localeCompare(b.id));

  const groups = [
    ...JOURNAL_GROUPS.map(([id, label]) => ({ id, label, kind: 'table' })),
    ...ACTION_GROUPS.map(([id, label]) => ({ id, label, kind: 'action' })),
  ];

  // No build timestamp: the file is checked in, and a timestamp would make
  // every rebuild a diff even when nothing about the content changed.
  const payload = {
    version: 1,
    upstream: { repo: LOCK.repo, commit: LOCK.commit },
    licence: {
      notice: 'Reference text is Open RPG Creative (ORC) licensed content from '
        + 'Paizo Inc. See LICENSE-ORC.txt and the compatibility statement in the README.',
    },
    groups,
    entries,
  };

  mkdirSync(resolvePath(PROJECT_ROOT, 'data'), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 1)}\n`);

  const bytes = Buffer.byteLength(JSON.stringify(payload));
  console.log(`  data/reference.json  ${entries.length} entries, ${(bytes / 1024).toFixed(0)} KB`);
  if (report.missingPages.length) {
    console.log(`  journal pages not found: ${report.missingPages.join(', ')}`);
  }
  if (report.uncitedPages.length) {
    console.log(`  no page citation found on: ${report.uncitedPages.join(', ')}`);
  }
  if (report.missingPacks.length) {
    console.log(`  action packs not found: ${report.missingPacks.join(', ')}`);
  }
  if (report.unresolvedLinks.length) {
    console.log(`  ${report.unresolvedLinks.length} link(s) had no target and render as plain text:`);
    for (const uuid of new Set(report.unresolvedLinks)) console.log(`    ${uuid}`);
  }
}

main();
