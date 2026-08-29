/**
 * Two campaigns with overlapping players, which is the shape the isolation
 * tests need: the same person plays in both, so "this token belongs to Sam"
 * is never enough on its own.
 */
import { buildApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/server/db.js';
import { createCampaign } from '../../src/server/store/campaigns.js';
import { createCharacter } from '../../src/server/store/characters.js';
import { createEncounter } from '../../src/server/store/encounters.js';
import { addCombatant, startCombat } from '../../src/server/store/combat.js';
import {
  mintCharacterToken, mintGmToken, mintTableToken,
} from '../../src/server/store/tokens.js';
import { resolveScope } from '../../src/server/scope.js';

export function freshDb() {
  return openDatabase(':memory:', { migrationsDir: 'migrations' });
}

export function seed(db) {
  const gmToken = mintGmToken(db);
  const gm = resolveScope(db, gmToken);

  const tuesday = createCampaign(db, gm, { name: 'Tuesday: Abomination Vaults', partyLevel: 4 });
  const saturday = createCampaign(db, gm, { name: 'Saturday: Kingmaker', partyLevel: 7 });

  // The same player, in both campaigns, with two different characters.
  const kestrel = createCharacter(db, gm, tuesday.id, { name: 'Kestrel', playerName: 'Alex', level: 4 });
  const brambles = createCharacter(db, gm, saturday.id, { name: 'Brambles', playerName: 'Alex', level: 7 });
  const other = createCharacter(db, gm, tuesday.id, { name: 'Dorn', playerName: 'Sam', level: 4 });

  const tuesdayEncounter = createEncounter(db, gm, tuesday.id, { name: 'Ambush in the stairwell' });
  const saturdayEncounter = createEncounter(db, gm, saturday.id, { name: 'Trolls at the ford' });

  const tuesdayCombat = startCombat(db, gm, tuesday.id, { name: 'Stairwell' });
  addCombatant(db, gm, tuesdayCombat.id, {
    characterId: kestrel.id, displayName: 'Kestrel', initiative: 18, hpCurrent: 40, hpMax: 48,
  }, tuesday.id);
  addCombatant(db, gm, tuesdayCombat.id, {
    creatureId: 'goblin-warrior', displayName: 'Goblin A', initiative: 12, hpCurrent: 6, hpMax: 6,
  }, tuesday.id);

  const saturdayCombat = startCombat(db, gm, saturday.id, { name: 'The ford' });
  addCombatant(db, gm, saturdayCombat.id, {
    creatureId: 'forest-troll', displayName: 'Troll A', initiative: 14, hpCurrent: 100, hpMax: 115,
  }, saturday.id);

  const kestrelToken = mintCharacterToken(db, gm, kestrel.id, tuesday.id).token;
  const bramblesToken = mintCharacterToken(db, gm, brambles.id, saturday.id).token;
  const tuesdayTable = mintTableToken(db, gm, tuesday.id).token;
  const saturdayTable = mintTableToken(db, gm, saturday.id).token;

  return {
    gmToken,
    tuesday: {
      campaign: tuesday,
      characters: { kestrel, other },
      encounter: tuesdayEncounter,
      combat: tuesdayCombat,
      characterToken: kestrelToken,
      tableToken: tuesdayTable,
    },
    saturday: {
      campaign: saturday,
      characters: { brambles },
      encounter: saturdayEncounter,
      combat: saturdayCombat,
      characterToken: bramblesToken,
      tableToken: saturdayTable,
    },
  };
}

export async function freshApp() {
  const db = freshDb();
  const world = seed(db);
  const app = await buildApp({ db, logger: false });
  await app.ready();
  return { app, db, world };
}
