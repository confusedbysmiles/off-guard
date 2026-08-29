/**
 * Characters, from the GM's side. The player's own routes are in
 * `routes/character.js` and take no character id at all.
 */
import { applyPatch, createCharacter, getCharacter, listCharacters } from '../../store/characters.js';
import { publishCharacter, publishTable } from '../../publish.js';

export async function registerCharacterAdminRoutes(app) {
  const { db } = app;

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

  app.patch('/campaigns/:campaignId/characters/:characterId', async (request) => {
    const result = applyPatch(
      db, request.scope, request.params.characterId, request.body?.writes ?? [],
      { by: 'gm', campaignId: request.params.campaignId },
    );
    // Both directions: the player's own sheet, and the shared screen, which
    // shows player hit points.
    publishCharacter(app, request.scope, request.params.characterId, request.params.campaignId);
    publishTable(app, request.scope, request.params.campaignId);
    return result;
  });
}
