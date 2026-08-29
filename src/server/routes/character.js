/**
 * A player's API. One character, in one campaign.
 *
 * No route here takes a character id. The token names the character, so there
 * is nothing for a client to forge -- the closest it can get is asking for its
 * own sheet.
 */
import { applyPatch, getOwnCharacter, versionsFor } from '../store/characters.js';
import { getCampaign } from '../store/campaigns.js';

export async function registerCharacterRoutes(app) {
  const { db } = app;

  app.get('/', async (request) => {
    const character = getOwnCharacter(db, request.scope);
    const campaign = getCampaign(db, request.scope);
    return {
      character,
      versions: versionsFor(db, character.id),
      // Enough campaign context to theme the sheet and name the table, and
      // nothing about the other players.
      campaign: { id: campaign.id, name: campaign.name, accentColor: campaign.accentColor },
    };
  });

  app.patch('/', async (request) => applyPatch(
    db, request.scope, request.scope.characterId, request.body?.writes ?? [], { by: 'player' },
  ));
}
