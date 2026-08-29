/**
 * The GM's API. One token, every campaign.
 *
 * The campaign id is a path parameter rather than a body field, so it is
 * visible in the route and goes through `campaignFor` on every call.
 */
import {
  archiveCampaign, campaignOverview, createCampaign, getCampaign, listCampaigns, updateCampaign,
} from '../store/campaigns.js';
import { applyPatch, createCharacter, getCharacter, listCharacters } from '../store/characters.js';
import {
  copyEncounter, createEncounter, deleteEncounter, getEncounter, listEncounters, setCreatures,
} from '../store/encounters.js';
import { addCombatant, getActiveCombat, startCombat, tableView } from '../store/combat.js';
import {
  listTokens, mintCharacterToken, mintTableToken, recentFailures, rotateToken,
} from '../store/tokens.js';

export async function registerGmRoutes(app) {
  const { db } = app;

  app.get('/campaigns', async (request) => ({
    campaigns: listCampaigns(db, request.scope, { includeArchived: true }),
  }));

  app.get('/overview', async (request) => ({ campaigns: campaignOverview(db, request.scope) }));

  app.post('/campaigns', async (request, reply) => {
    const campaign = createCampaign(db, request.scope, request.body ?? {});
    reply.status(201);
    return { campaign };
  });

  app.get('/campaigns/:campaignId', async (request) => ({
    campaign: getCampaign(db, request.scope, request.params.campaignId),
  }));

  app.patch('/campaigns/:campaignId', async (request) => ({
    campaign: updateCampaign(db, request.scope, request.params.campaignId, request.body ?? {}),
  }));

  app.post('/campaigns/:campaignId/archive', async (request) => ({
    campaign: archiveCampaign(db, request.scope, request.params.campaignId, request.body?.archived ?? true),
  }));

  // Characters ------------------------------------------------------------

  app.get('/campaigns/:campaignId/characters', async (request) => ({
    characters: listCharacters(db, request.scope, request.params.campaignId),
  }));

  app.post('/campaigns/:campaignId/characters', async (request, reply) => {
    const character = createCharacter(db, request.scope, request.params.campaignId, request.body ?? {});
    reply.status(201);
    return { character };
  });

  app.get('/campaigns/:campaignId/characters/:characterId', async (request) => ({
    character: getCharacter(db, request.scope, request.params.characterId, request.params.campaignId),
  }));

  app.patch('/campaigns/:campaignId/characters/:characterId', async (request) => applyPatch(
    db, request.scope, request.params.characterId, request.body?.writes ?? [],
    { by: 'gm', campaignId: request.params.campaignId },
  ));

  // Encounters ------------------------------------------------------------

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

  // Initiative ------------------------------------------------------------

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

  // Links -----------------------------------------------------------------

  app.get('/campaigns/:campaignId/tokens', async (request) => ({
    tokens: listTokens(db, request.scope, request.params.campaignId),
  }));

  app.post('/campaigns/:campaignId/tokens/character/:characterId', async (request, reply) => {
    const token = mintCharacterToken(
      db, request.scope, request.params.characterId, request.params.campaignId,
    );
    reply.status(201);
    return { token };
  });

  app.post('/campaigns/:campaignId/tokens/table', async (request, reply) => {
    const token = mintTableToken(db, request.scope, request.params.campaignId);
    reply.status(201);
    return { token };
  });

  app.post('/tokens/:tokenId/rotate', async (request) => ({
    token: rotateToken(db, request.scope, request.params.tokenId),
  }));

  app.get('/access-failures', async (request) => ({
    failures: recentFailures(db, { minutes: Number(request.query?.minutes ?? 60) }),
  }));
}
