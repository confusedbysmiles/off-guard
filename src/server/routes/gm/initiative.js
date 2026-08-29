/**
 * Initiative.
 *
 * Every route takes the campaign id in the path, so a combat or combatant id
 * from another campaign is refused before anything is written -- the GM reaches
 * every campaign, which is exactly why the id cannot be inferred from the row.
 */
import {
  addCombatant, advanceTurn, damageCombatant, endCombat, getActiveCombat, getCombatant,
  removeCombatant, reorderCombatants, sortByInitiative, startCombat, tableView, updateCombatant,
} from '../../store/combat.js';
import { recallKnowledge } from '../../../rules/index.js';
import { rollInitiative } from '../../initiative.js';
import { partyFor } from '../../party.js';
import { publishCharacter, publishTable } from '../../publish.js';

export async function registerInitiativeRoutes(app) {
  const { db, catalogue } = app;

  app.get('/campaigns/:campaignId/combat', async (request) => ({
    combat: getActiveCombat(db, request.scope, request.params.campaignId),
  }));

  app.post('/campaigns/:campaignId/combat', async (request, reply) => {
    const combat = startCombat(db, request.scope, request.params.campaignId, request.body ?? {});
    publishTable(app, request.scope, request.params.campaignId);
    reply.status(201);
    return { combat };
  });

  app.post('/campaigns/:campaignId/combat/:combatId/combatants', async (request, reply) => {
    const combatant = addCombatant(
      db, request.scope, request.params.combatId, request.body ?? {}, request.params.campaignId,
    );
    publishTable(app, request.scope, request.params.campaignId);
    reply.status(201);
    return { combatant };
  });

  /**
   * Fill a combat from an encounter and the party in one go.
   *
   * Creature initiative is rolled here rather than in the browser: the roll
   * needs the stat block, and asking the client for a modifier would let a
   * mistake in the interface change the numbers.
   */
  app.post('/campaigns/:campaignId/combat/:combatId/populate', async (request) => {
    const { campaignId, combatId } = request.params;
    const body = request.body ?? {};
    const party = partyFor(db, request.scope, campaignId);

    const added = rollInitiative({
      db,
      scope: request.scope,
      catalogue,
      campaignId,
      combatId,
      party,
      encounterId: body.encounterId ?? null,
      skill: body.skill ?? 'perception',
      includeParty: body.includeParty !== false,
    });

    sortByInitiative(db, request.scope, combatId, campaignId);
    publishTable(app, request.scope, campaignId);
    return { combat: getActiveCombat(db, request.scope, campaignId), added };
  });

  app.patch('/campaigns/:campaignId/combat/combatants/:combatantId', async (request) => {
    const combatant = updateCombatant(
      db, request.scope, request.params.combatantId, request.body ?? {}, request.params.campaignId,
    );
    publishTable(app, request.scope, request.params.campaignId);
    // A condition pushed onto a player's combatant lands on their sheet, so it
    // has to reach the phone they are holding as well as the shared screen.
    if (combatant.characterId) {
      publishCharacter(app, request.scope, combatant.characterId, request.params.campaignId);
    }
    return { combatant };
  });

  app.delete('/campaigns/:campaignId/combat/combatants/:combatantId', async (request) => {
    const result = removeCombatant(
      db, request.scope, request.params.combatantId, request.params.campaignId,
    );
    publishTable(app, request.scope, request.params.campaignId);
    return result;
  });

  /** A negative amount heals; the rules engine decides what that means. */
  app.post('/campaigns/:campaignId/combat/combatants/:combatantId/damage', async (request) => {
    const result = damageCombatant(
      db, request.scope, request.params.combatantId, request.body?.amount ?? 0,
      request.params.campaignId,
    );
    publishTable(app, request.scope, request.params.campaignId);
    return result;
  });

  app.post('/campaigns/:campaignId/combat/:combatId/sort', async (request) => {
    const combat = sortByInitiative(
      db, request.scope, request.params.combatId, request.params.campaignId,
    );
    publishTable(app, request.scope, request.params.campaignId);
    return { combat };
  });

  app.post('/campaigns/:campaignId/combat/:combatId/order', async (request) => {
    const combat = reorderCombatants(
      db, request.scope, request.params.combatId, request.body?.order ?? [], request.params.campaignId,
    );
    publishTable(app, request.scope, request.params.campaignId);
    return { combat };
  });

  app.post('/campaigns/:campaignId/combat/:combatId/advance', async (request) => {
    const result = advanceTurn(
      db, request.scope, request.params.combatId,
      { direction: Number(request.body?.direction ?? 1) },
      request.params.campaignId,
    );
    publishTable(app, request.scope, request.params.campaignId);
    return result;
  });

  app.post('/campaigns/:campaignId/combat/:combatId/end', async (request) => {
    const result = endCombat(db, request.scope, request.params.combatId, request.params.campaignId);
    publishTable(app, request.scope, request.params.campaignId);
    return result;
  });

  /**
   * Recall Knowledge against a combatant.
   *
   * The stat block stored on the row is the adjusted one -- elite, weak or
   * scaled -- which is the creature the party is actually fighting and so the
   * one a successful check should describe. `revealed` comes back marked so
   * the helper can show what the table already knows.
   */
  app.get('/campaigns/:campaignId/combat/combatants/:combatantId/recall-knowledge',
    async (request, reply) => {
      const { campaignId, combatantId } = request.params;
      const combatant = getCombatant(db, request.scope, combatantId, campaignId);
      const creature = combatant.statBlock
        ?? (combatant.creatureId ? catalogue.get(combatant.creatureId) : null);
      if (!creature) {
        reply.status(404);
        return { error: 'This combatant has no stat block to recall anything about' };
      }
      const helper = recallKnowledge(creature, {
        revealed: (combatant.revealed ?? []).map((f) => (typeof f === 'string' ? f : f.key)),
        difficulty: request.query?.difficulty ?? null,
      });
      return { ...helper, combatantId: Number(combatantId) };
    });

  /** What the table is seeing right now, so the GM can check before revealing. */
  app.get('/campaigns/:campaignId/table-view', async (request) => tableView(
    db, request.scope, request.params.campaignId,
  ));
}
