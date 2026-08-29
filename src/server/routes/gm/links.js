/** Minting and rotating the links, and the record of failed attempts. */
import {
  listTokens, mintCharacterToken, mintTableToken, recentFailures, rotateToken,
} from '../../store/tokens.js';

export async function registerLinkRoutes(app) {
  const { db } = app;

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
