/**
 * Characters, from the GM's side. The player's own routes are in
 * `routes/character.js` and take no character id at all.
 */
import {
  applyPatch, createCharacter, deleteCharacter, getCharacter, listCharacters,
} from '../../store/characters.js';
import { publishCharacter, publishTable } from '../../publish.js';
import { exportCharacter } from '../../../shared/portable.js';

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

  /**
   * One character as a file.
   *
   * The same envelope the player's own export produces, so the two are
   * interchangeable -- a GM can hand somebody their character back without
   * handing them a link, and a character can move between campaigns on this
   * server or off it entirely. Campaign-scoped like everything else here: the
   * id in the path is checked against the one the token resolved to.
   */
  app.get('/campaigns/:campaignId/characters/:characterId/export', async (request) => exportCharacter(
    getCharacter(db, request.scope, request.params.characterId, request.params.campaignId),
  ));

  app.delete('/campaigns/:campaignId/characters/:characterId', async (request) => {
    const result = deleteCharacter(
      db, request.scope, request.params.characterId, request.params.campaignId,
    );
    // The shared screen may have had them in the initiative order.
    publishTable(app, request.scope, request.params.campaignId);
    return result;
  });

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
