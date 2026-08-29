/**
 * Minting and rotating the links, and the record of failed attempts.
 *
 * A minted or rotated link comes back in the response and is never retrievable
 * again -- only its hash is stored. `GET .../tokens` therefore lists what links
 * exist and what each is for, not what they are, and says so with
 * `retrievable: false` so an interface cannot be written against a field that
 * will always be absent.
 */
import {
  listTokens, mintCharacterToken, mintTableToken, recentFailures, rotateToken,
} from '../../store/tokens.js';

export async function registerLinkRoutes(app) {
  const { db } = app;

  app.get('/campaigns/:campaignId/tokens', async (request) => ({
    tokens: listTokens(db, request.scope, request.params.campaignId),
    retrievable: false,
  }));

  /** The one moment this link exists outside the database as something usable. */
  app.post('/campaigns/:campaignId/tokens/character/:characterId', async (request, reply) => {
    const token = mintCharacterToken(
      db, request.scope, request.params.characterId, request.params.campaignId,
    );
    reply.status(201);
    return { token, showOnce: true };
  });

  app.post('/campaigns/:campaignId/tokens/table', async (request, reply) => {
    const token = mintTableToken(db, request.scope, request.params.campaignId);
    reply.status(201);
    return { token, showOnce: true };
  });

  app.post('/tokens/:tokenId/rotate', async (request) => ({
    token: rotateToken(db, request.scope, request.params.tokenId),
    showOnce: true,
  }));

  app.get('/access-failures', async (request) => ({
    failures: recentFailures(db, { minutes: Number(request.query?.minutes ?? 60) }),
  }));
}
