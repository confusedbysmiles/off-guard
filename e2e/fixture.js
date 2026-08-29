/**
 * The world the end-to-end tests run against.
 *
 * One campaign, three characters, one encounter and a fight already rolled, so
 * every surface has something real on it. The tokens are written to a file the
 * tests read, because they are generated and cannot be hardcoded — one file per
 * server port, since each Playwright project gets its own.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../src/server/db.js';
import { resolveScope } from '../src/server/scope.js';
import { createCampaign } from '../src/server/store/campaigns.js';
import { applyPatch, createCharacter } from '../src/server/store/characters.js';
import { createEncounter, setCreatures } from '../src/server/store/encounters.js';
import { addCombatant, startCombat } from '../src/server/store/combat.js';
import { mintCharacterToken, mintGmToken, mintTableToken } from '../src/server/store/tokens.js';
import { worldFile } from './world.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SHEET = {
  name: 'Kestrel Vane', playerName: 'Alex', level: 5, class: 'Fighter', keyAttribute: 'str',
  abilities: { str: 4, dex: 2, con: 3, int: 0, wis: 1, cha: -1 },
  hp: { max: 62, current: 50, temp: 0 },
  ac: { rank: 'expert', itemBonus: 6, dexCap: 1 },
  perception: { rank: 'master' },
  saves: { fortitude: { rank: 'master' }, reflex: { rank: 'expert' }, will: { rank: 'expert' } },
  skills: { athletics: { rank: 'expert' } },
  heroPoints: 1, conditions: [], notes: '',
};

export function buildFixture(port) {
  const dir = mkdtempSync(join(tmpdir(), 'off-guard-e2e-'));
  const file = join(dir, 'e2e.sqlite');
  const db = openDatabase(file, { migrationsDir: join(ROOT, 'migrations') });

  const gmToken = mintGmToken(db);
  const gm = resolveScope(db, gmToken);

  const campaign = createCampaign(db, gm, {
    name: 'Tuesday: Abomination Vaults', partyLevel: 5, accentColor: '#667EEA',
    adventure: 'Abomination Vaults', chapter: 'Book 1',
  });

  const kestrel = createCharacter(db, gm, campaign.id, {
    name: 'Kestrel Vane', playerName: 'Alex', level: 5,
  });
  applyPatch(db, gm, kestrel.id,
    Object.entries(SHEET).map(([path, value]) => ({ path, value })),
    { by: 'gm', campaignId: campaign.id });

  const dorn = createCharacter(db, gm, campaign.id, {
    name: 'Dorn Ashfell', playerName: 'Sam', level: 5,
  });
  applyPatch(db, gm, dorn.id, [
    { path: 'name', value: 'Dorn Ashfell' },
    { path: 'hp', value: { max: 54, current: 54, temp: 0 } },
  ], { by: 'gm', campaignId: campaign.id });

  const encounter = createEncounter(db, gm, campaign.id, { name: 'Ambush in the stairwell' });
  setCreatures(db, gm, encounter.id, [
    { creatureId: 'goblin-warrior', displayName: 'Goblin Warrior', count: 2 },
  ], campaign.id);

  const combat = startCombat(db, gm, campaign.id, { name: 'Stairwell' });
  const combatants = {
    kestrel: addCombatant(db, gm, combat.id, {
      characterId: kestrel.id, displayName: 'Kestrel Vane', initiative: 21,
      hpCurrent: 50, hpMax: 62, sortOrder: 0, visible: true, hpNumeric: true,
    }, campaign.id),
    dorn: addCombatant(db, gm, combat.id, {
      characterId: dorn.id, displayName: 'Dorn Ashfell', initiative: 14,
      hpCurrent: 54, hpMax: 54, sortOrder: 1, visible: true, hpNumeric: true,
    }, campaign.id),
    goblin: addCombatant(db, gm, combat.id, {
      creatureId: 'goblin-warrior', displayName: 'Goblin Warrior A', initiative: 18,
      hpCurrent: 6, hpMax: 6, sortOrder: 2, visible: true,
    }, campaign.id),
    hidden: addCombatant(db, gm, combat.id, {
      creatureId: 'goblin-warrior', displayName: 'Goblin Warrior B', initiative: 9,
      hpCurrent: 6, hpMax: 6, sortOrder: 3, visible: false,
    }, campaign.id),
  };

  const world = {
    database: file,
    gmToken,
    characterToken: mintCharacterToken(db, gm, kestrel.id, campaign.id).token,
    tableToken: mintTableToken(db, gm, campaign.id).token,
    campaignId: campaign.id,
    characterId: kestrel.id,
    encounterId: encounter.id,
    combatId: combat.id,
    combatants: Object.fromEntries(
      Object.entries(combatants).map(([key, value]) => [key, value.id]),
    ),
  };

  db.close();
  writeFileSync(join(dir, 'world.json'), JSON.stringify(world, null, 2));
  // Named for the port it belongs to: each Playwright project runs its own
  // server against its own database, and they must not read each other's.
  writeFileSync(worldFile(port), JSON.stringify(world, null, 2));
  return world;
}
