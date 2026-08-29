/**
 * Initiative.
 *
 * Every route takes the campaign id in the path, so a combat or combatant id
 * from another campaign is refused before anything is written -- the GM reaches
 * every campaign, which is exactly why the id cannot be inferred from the row.
 */
import {
  addCombatant, advanceTurn, damageCombatant, endCombat, getActiveCombat, removeCombatant,
  reorderCombatants, sortByInitiative, startCombat, tableView, updateCombatant,
} from '../../store/combat.js';
import { rollInitiative } from '../../initiative.js';
import { partyFor } from '../../party.js';

export async function registerInitiativeRoutes(app) {
  const { db, catalogue } = app;

  app.get('/campaigns/:campaignId/combat', async (request) => ({
    combat: getActiveCombat(db, request.scope, request.params.campaignId),
  }));

  app.post('/campaigns/:campaignId/combat', async (request, reply) => {
    const combat = startCombat(db, request.scope, request.params.campaignId, request.body ?? {});
    reply.status(201);
    return { combat };
  });

  app.post('/campaigns/:campaignId/combat/:combatId/combatants', async (request, reply) => {
    const combatant = addCombatant(
      db, request.scope, request.params.combatId, request.body ?? {}, request.params.campaignId,
    );
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
    return { combat: getActiveCombat(db, request.scope, campaignId), added };
  });

  app.patch('/campaigns/:campaignId/combat/combatants/:combatantId', async (request) => ({
    combatant: updateCombatant(
      db, request.scope, request.params.combatantId, request.body ?? {}, request.params.campaignId,
    ),
  }));

  app.delete('/campaigns/:campaignId/combat/combatants/:combatantId', async (request) => removeCombatant(
    db, request.scope, request.params.combatantId, request.params.campaignId,
  ));

  /** A negative amount heals; the rules engine decides what that means. */
  app.post('/campaigns/:campaignId/combat/combatants/:combatantId/damage', async (request) => damageCombatant(
    db, request.scope, request.params.combatantId, request.body?.amount ?? 0, request.params.campaignId,
  ));

  app.post('/campaigns/:campaignId/combat/:combatId/sort', async (request) => ({
    combat: sortByInitiative(db, request.scope, request.params.combatId, request.params.campaignId),
  }));

  app.post('/campaigns/:campaignId/combat/:combatId/order', async (request) => ({
    combat: reorderCombatants(
      db, request.scope, request.params.combatId, request.body?.order ?? [], request.params.campaignId,
    ),
  }));

  app.post('/campaigns/:campaignId/combat/:combatId/advance', async (request) => advanceTurn(
    db, request.scope, request.params.combatId,
    { direction: Number(request.body?.direction ?? 1) },
    request.params.campaignId,
  ));

  app.post('/campaigns/:campaignId/combat/:combatId/end', async (request) => endCombat(
    db, request.scope, request.params.combatId, request.params.campaignId,
  ));

  /** What the table is seeing right now, so the GM can check before revealing. */
  app.get('/campaigns/:campaignId/table-view', async (request) => tableView(
    db, request.scope, request.params.campaignId,
  ));
}
