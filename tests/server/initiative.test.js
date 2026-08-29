/**
 * The initiative tracker, server side.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { initiativeModifier, rollInitiative } from '../../src/server/initiative.js';
import { resolveScope } from '../../src/server/scope.js';
import { partyFor } from '../../src/server/party.js';
import { getActiveCombat } from '../../src/server/store/combat.js';
import { freshDb, seed } from './helpers.js';
import { stubCatalogue } from './stub-catalogue.js';

let app; let db; let world; let catalogue;

beforeEach(async () => {
  db = freshDb();
  world = seed(db);
  catalogue = stubCatalogue();
  app = await buildApp({ db, catalogue, logger: false });
  await app.ready();
});
afterEach(async () => { await app.close(); db.close(); });

const tuesday = () => world.tuesday.campaign.id;
const post = (path, payload = {}) => app.inject({
  method: 'POST', url: `/api/gm/${world.gmToken}${path}`, payload,
});
const patch = (path, payload) => app.inject({
  method: 'PATCH', url: `/api/gm/${world.gmToken}${path}`, payload,
});
const get = (path) => app.inject({ method: 'GET', url: `/api/gm/${world.gmToken}${path}` });

describe('rolling initiative', () => {
  it('rolls for creatures and leaves the players blank', () => {
    const scope = resolveScope(db, world.gmToken);
    const party = partyFor(db, scope, tuesday());
    // A fixed roll, so the assertion is about the modifier rather than luck.
    const added = rollInitiative({
      db, scope, catalogue, campaignId: tuesday(),
      combatId: world.tuesday.combat.id, party,
      encounterId: world.tuesday.encounter.id, random: () => 0.5,
    });

    const players = added.filter((a) => a.initiative === null);
    expect(players.length).toBe(party.characters.length);
    // Inventing an initiative for someone else's character is the one thing a
    // tracker must not do.
    expect(players.every((p) => p.initiative === null)).toBe(true);
  });

  it('uses the statistic the GM chose', () => {
    const goblin = catalogue.get('goblin-warrior');
    expect(initiativeModifier(goblin, 'perception')).toBe(goblin.perception.mod);
    expect(initiativeModifier(goblin, 'stealth')).toBe(
      goblin.skills.find((s) => s.slug === 'stealth').mod,
    );
  });

  it('falls back to Perception for a skill the creature does not have', () => {
    const goblin = catalogue.get('goblin-warrior');
    expect(initiativeModifier(goblin, 'occultism')).toBe(goblin.perception.mod);
  });

  it('rolls a creature at its adjusted statistics', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/gm/${world.gmToken}/campaigns/${tuesday()}/encounters/${world.tuesday.encounter.id}/creatures`,
      payload: { creatures: [{ creatureId: 'goblin-warrior', adjustment: 'elite', count: 1 }] },
    });

    const { combat } = (await post(`/campaigns/${tuesday()}/combat`, {})).json();
    await post(`/campaigns/${tuesday()}/combat/${combat.id}/populate`, {
      encounterId: world.tuesday.encounter.id, includeParty: false,
    });

    const live = (await get(`/campaigns/${tuesday()}/combat`)).json().combat;
    const goblin = live.combatants.find((c) => c.creatureId === 'goblin-warrior');
    // Elite raises Perception by 2, and the stat block is snapshotted.
    expect(goblin.statBlock.adjustment.kind).toBe('elite');
    expect(goblin.statBlock.perception.mod).toBe(catalogue.get('goblin-warrior').perception.mod + 2);
    expect(goblin.hpMax).toBe(goblin.statBlock.hp.max);
  });

  it('hides creatures from the shared screen until the GM reveals them', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/gm/${world.gmToken}/campaigns/${tuesday()}/encounters/${world.tuesday.encounter.id}/creatures`,
      payload: { creatures: [{ creatureId: 'goblin-warrior', count: 2 }] },
    });
    const { combat } = (await post(`/campaigns/${tuesday()}/combat`, {})).json();
    await post(`/campaigns/${tuesday()}/combat/${combat.id}/populate`, {
      encounterId: world.tuesday.encounter.id,
    });

    const table = (await app.inject({
      method: 'GET', url: `/api/table/${world.tuesday.tableToken}`,
    })).json();
    expect(table.combatants.every((c) => c.isPlayer)).toBe(true);
  });

  it('letters duplicates of the same creature', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/gm/${world.gmToken}/campaigns/${tuesday()}/encounters/${world.tuesday.encounter.id}/creatures`,
      payload: { creatures: [{ creatureId: 'goblin-warrior', displayName: 'Goblin', count: 3 }] },
    });
    const { combat } = (await post(`/campaigns/${tuesday()}/combat`, {})).json();
    await post(`/campaigns/${tuesday()}/combat/${combat.id}/populate`, {
      encounterId: world.tuesday.encounter.id, includeParty: false,
    });
    const live = (await get(`/campaigns/${tuesday()}/combat`)).json().combat;
    expect(live.combatants.map((c) => c.displayName).sort())
      .toEqual(['Goblin A', 'Goblin B', 'Goblin C']);
  });
});

describe('ordering', () => {
  async function threeCombatants() {
    const { combat } = (await post(`/campaigns/${tuesday()}/combat`, {})).json();
    for (const [name, initiative] of [['Slow', 5], ['Fast', 22], ['Tied', 22]]) {
      await post(`/campaigns/${tuesday()}/combat/${combat.id}/combatants`, {
        displayName: name, initiative, hpCurrent: 10, hpMax: 10,
      });
    }
    return combat;
  }

  it('sorts descending', async () => {
    const combat = await threeCombatants();
    await post(`/campaigns/${tuesday()}/combat/${combat.id}/sort`);
    const live = (await get(`/campaigns/${tuesday()}/combat`)).json().combat;
    expect(live.combatants.map((c) => c.initiative)).toEqual([22, 22, 5]);
  });

  it('leaves a tie in the order it was already in, for the GM to drag', async () => {
    const combat = await threeCombatants();
    await post(`/campaigns/${tuesday()}/combat/${combat.id}/sort`);
    const before = (await get(`/campaigns/${tuesday()}/combat`)).json().combat;
    expect(before.combatants.slice(0, 2).map((c) => c.displayName)).toEqual(['Fast', 'Tied']);

    const flipped = [before.combatants[1].id, before.combatants[0].id, before.combatants[2].id];
    await post(`/campaigns/${tuesday()}/combat/${combat.id}/order`, { order: flipped });
    const after = (await get(`/campaigns/${tuesday()}/combat`)).json().combat;
    expect(after.combatants.map((c) => c.displayName)).toEqual(['Tied', 'Fast', 'Slow']);

    // A re-sort must not undo the drag.
    await post(`/campaigns/${tuesday()}/combat/${combat.id}/sort`);
    const resorted = (await get(`/campaigns/${tuesday()}/combat`)).json().combat;
    expect(resorted.combatants.map((c) => c.displayName)).toEqual(['Tied', 'Fast', 'Slow']);
  });
});

describe('advancing the turn', () => {
  async function twoCombatants() {
    const { combat } = (await post(`/campaigns/${tuesday()}/combat`, {})).json();
    const first = (await post(`/campaigns/${tuesday()}/combat/${combat.id}/combatants`, {
      displayName: 'First', initiative: 20, hpCurrent: 30, hpMax: 30, sortOrder: 0,
    })).json().combatant;
    const second = (await post(`/campaigns/${tuesday()}/combat/${combat.id}/combatants`, {
      displayName: 'Second', initiative: 10, hpCurrent: 30, hpMax: 30, sortOrder: 1,
    })).json().combatant;
    return { combat, first, second };
  }

  it('moves to the next combatant', async () => {
    const { combat } = await twoCombatants();
    const result = (await post(`/campaigns/${tuesday()}/combat/${combat.id}/advance`, { direction: 1 })).json();
    expect(result.combat.turnIndex).toBe(1);
    expect(result.combat.round).toBe(1);
  });

  it('wraps to a new round', async () => {
    const { combat } = await twoCombatants();
    await post(`/campaigns/${tuesday()}/combat/${combat.id}/advance`, { direction: 1 });
    const result = (await post(`/campaigns/${tuesday()}/combat/${combat.id}/advance`, { direction: 1 })).json();
    expect(result.combat.turnIndex).toBe(0);
    expect(result.combat.round).toBe(2);
  });

  it('steps back without losing the round', async () => {
    const { combat } = await twoCombatants();
    await post(`/campaigns/${tuesday()}/combat/${combat.id}/advance`, { direction: 1 });
    const result = (await post(`/campaigns/${tuesday()}/combat/${combat.id}/advance`, { direction: -1 })).json();
    expect(result.combat.turnIndex).toBe(0);
    expect(result.combat.round).toBe(1);
  });

  it('decreases frightened on the combatant whose turn ended', async () => {
    const { combat, first } = await twoCombatants();
    await patch(`/campaigns/${tuesday()}/combat/combatants/${first.id}`, {
      conditions: [{ slug: 'frightened', value: 2 }],
    });
    const result = (await post(`/campaigns/${tuesday()}/combat/${combat.id}/advance`, { direction: 1 })).json();
    const after = result.combat.combatants.find((c) => c.id === first.id);
    expect(after.conditions).toEqual([{ slug: 'frightened', value: 1 }]);
    expect(result.prompts.some((p) => p.kind === 'decrement')).toBe(true);
  });

  it('asks rather than deciding when a rule is ambiguous', async () => {
    const { combat, first } = await twoCombatants();
    await patch(`/campaigns/${tuesday()}/combat/combatants/${first.id}`, {
      conditions: [{ slug: 'stunned', value: 3 }],
    });
    const result = (await post(`/campaigns/${tuesday()}/combat/${combat.id}/advance`, { direction: 1 })).json();
    const after = result.combat.combatants.find((c) => c.id === first.id);
    expect(after.conditions).toEqual([{ slug: 'stunned', value: 3 }]);
    expect(result.prompts.find((p) => p.kind === 'stunned').because).toMatch(/actions actually lost/);
  });

  it('asks for a recovery check when a dying combatant’s turn begins', async () => {
    const { combat, second } = await twoCombatants();
    await patch(`/campaigns/${tuesday()}/combat/combatants/${second.id}`, { dying: 2 });
    const result = (await post(`/campaigns/${tuesday()}/combat/${combat.id}/advance`, { direction: 1 })).json();
    const prompt = result.prompts.find((p) => p.kind === 'recovery-check');
    expect(prompt).toMatchObject({ dying: 2, dc: 12, when: 'start' });
  });
});

describe('damage through the API', () => {
  it('applies the rules engine and reports what happened', async () => {
    const { combat } = (await post(`/campaigns/${tuesday()}/combat`, {})).json();
    const { combatant } = (await post(`/campaigns/${tuesday()}/combat/${combat.id}/combatants`, {
      displayName: 'Kestrel', hpCurrent: 12, hpMax: 48, hpTemp: 4,
    })).json();

    const hit = (await post(
      `/campaigns/${tuesday()}/combat/combatants/${combatant.id}/damage`, { amount: 20 },
    )).json();
    expect(hit.combatant.hpCurrent).toBe(0);
    expect(hit.combatant.hpTemp).toBe(0);
    expect(hit.combatant.dying).toBe(1);

    const healed = (await post(
      `/campaigns/${tuesday()}/combat/combatants/${combatant.id}/damage`, { amount: -10 },
    )).json();
    expect(healed.combatant.hpCurrent).toBe(10);
    expect(healed.combatant.dying).toBe(0);
  });
});

describe('scoping', () => {
  it('refuses a combatant id from another campaign', async () => {
    const scope = resolveScope(db, world.gmToken);
    const other = getActiveCombat(db, scope, world.saturday.campaign.id);
    const res = await patch(
      `/campaigns/${tuesday()}/combat/combatants/${other.combatants[0].id}`, { notes: 'x' },
    );
    expect(res.statusCode).toBe(404);
  });

  it('refuses a table token outright', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/gm/${world.tuesday.tableToken}/campaigns/${tuesday()}/combat`,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('naming individual creatures when a fight starts', () => {
  it('letters a row that stands for several, without doubling the row’s letter', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/gm/${world.gmToken}/campaigns/${tuesday()}/encounters/${world.tuesday.encounter.id}/creatures`,
      payload: {
        creatures: [
          { creatureId: 'goblin-warrior', displayName: 'Goblin Warrior', count: 3 },
          { creatureId: 'ogre-warrior', displayName: 'Ogre Warrior', count: 1 },
        ],
      },
    });
    const { combat } = (await post(`/campaigns/${tuesday()}/combat`, {})).json();
    await post(`/campaigns/${tuesday()}/combat/${combat.id}/populate`, {
      encounterId: world.tuesday.encounter.id, includeParty: false,
    });

    const live = (await get(`/campaigns/${tuesday()}/combat`)).json().combat;
    const names = live.combatants.map((c) => c.displayName).sort();
    expect(names).toEqual(['Goblin Warrior A', 'Goblin Warrior B', 'Goblin Warrior C', 'Ogre Warrior']);
    expect(names.every((n) => !/ [A-Z] [A-Z]$/.test(n))).toBe(true);
  });
});

describe('the name a row is lettered from', () => {
  it('drops a trailing letter that duplicates the creature’s own name', async () => {
    const { baseNameFor } = await import('../../src/server/initiative.js');
    expect(baseNameFor('Goblin Warrior A', 'Goblin Warrior')).toBe('Goblin Warrior');
    expect(baseNameFor('Goblin Warrior', 'Goblin Warrior')).toBe('Goblin Warrior');
  });

  it('keeps a letter the GM meant, because it is not the creature’s name', () => {
    // "Squad B" is a name, not a generated suffix.
    return import('../../src/server/initiative.js').then(({ baseNameFor }) => {
      expect(baseNameFor('Squad B', 'Goblin Warrior')).toBe('Squad B');
      expect(baseNameFor('The one on the stairs', 'Goblin Warrior'))
        .toBe('The one on the stairs');
    });
  });
});
