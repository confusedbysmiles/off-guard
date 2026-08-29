/** Initiative, and a look at what the shared screen is currently showing. */
import { addCombatant, getActiveCombat, startCombat, tableView } from '../../store/combat.js';

export async function registerInitiativeRoutes(app) {
  const { db } = app;

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

  /** What the table is seeing right now, so the GM can check before revealing. */
  app.get('/campaigns/:campaignId/table-view', async (request) => tableView(
    db, request.scope, request.params.campaignId,
  ));
}
