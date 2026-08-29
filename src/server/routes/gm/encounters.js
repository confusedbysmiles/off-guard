/**
 * Encounters, including copying one into another campaign -- the only place in
 * the application that touches two campaigns in a single request.
 */
import {
  copyEncounter, createEncounter, deleteEncounter, getEncounter, listEncounters,
  reorderEncounters, setCreatures, updateEncounter,
} from '../../store/encounters.js';

export async function registerEncounterRoutes(app) {
  const { db } = app;

  app.get('/campaigns/:campaignId/encounters', async (request) => ({
    encounters: listEncounters(db, request.scope, request.params.campaignId),
  }));

  app.post('/campaigns/:campaignId/encounters', async (request, reply) => {
    const encounter = createEncounter(db, request.scope, request.params.campaignId, request.body ?? {});
    reply.status(201);
    return { encounter };
  });

  app.get('/campaigns/:campaignId/encounters/:encounterId', async (request) => ({
    encounter: getEncounter(db, request.scope, request.params.encounterId, request.params.campaignId),
  }));

  app.patch('/campaigns/:campaignId/encounters/:encounterId', async (request) => ({
    encounter: updateEncounter(
      db, request.scope, request.params.encounterId, request.body ?? {}, request.params.campaignId,
    ),
  }));

  app.post('/campaigns/:campaignId/encounters/reorder', async (request) => ({
    encounters: reorderEncounters(
      db, request.scope, request.body?.order ?? [], request.params.campaignId,
    ),
  }));

  app.put('/campaigns/:campaignId/encounters/:encounterId/creatures', async (request) => ({
    encounter: setCreatures(
      db, request.scope, request.params.encounterId,
      request.body?.creatures ?? [], request.params.campaignId,
    ),
  }));

  app.delete('/campaigns/:campaignId/encounters/:encounterId', async (request) => deleteEncounter(
    db, request.scope, request.params.encounterId, request.params.campaignId,
  ));

  app.post('/campaigns/:campaignId/encounters/:encounterId/copy', async (request, reply) => {
    const encounter = copyEncounter(
      db, request.scope, request.params.encounterId,
      request.params.campaignId, request.body?.toCampaignId,
    );
    reply.status(201);
    return { encounter };
  });
}
