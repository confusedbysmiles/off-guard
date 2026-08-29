/**
 * The dice roller.
 *
 * Rolling is a write: it appends to the log, and a roll that is not secret
 * reaches the shared screen. So every route here takes the campaign id in the
 * path like every other write, and republishes the table view afterwards.
 */
import { clearRolls, derive, listRolls, roll } from '../../store/rolls.js';
import { DiceError } from '../../../rules/dice.js';
import { publishTable } from '../../publish.js';

export async function registerRollRoutes(app) {
  const { db } = app;

  app.get('/campaigns/:campaignId/rolls', async (request) => ({
    rolls: listRolls(db, request.scope, request.params.campaignId, {
      limit: request.query?.limit ?? 50,
    }),
  }));

  app.post('/campaigns/:campaignId/rolls', async (request, reply) => {
    const body = request.body ?? {};
    let rolled;
    try {
      rolled = roll(db, request.scope, request.params.campaignId, {
        expression: body.expression,
        label: body.label ?? '',
        secret: Boolean(body.secret),
      });
    } catch (error) {
      // A typo in an expression is the user's, not the server's: 400 with the
      // parser's own sentence, which names the piece it could not read.
      if (error instanceof DiceError) {
        reply.status(400);
        return { error: error.message };
      }
      throw error;
    }
    // Even a secret roll republishes: the payload the table gets is rebuilt
    // from `visibleRolls`, which drops it, and republishing unconditionally
    // means secrecy is decided in one place rather than two.
    publishTable(app, request.scope, request.params.campaignId);
    reply.status(201);
    return { roll: rolled };
  });

  app.post('/campaigns/:campaignId/rolls/:rollId/:derivation', async (request, reply) => {
    const rolled = derive(
      db, request.scope, request.params.campaignId,
      request.params.rollId, request.params.derivation,
    );
    publishTable(app, request.scope, request.params.campaignId);
    reply.status(201);
    return { roll: rolled };
  });

  app.delete('/campaigns/:campaignId/rolls', async (request) => {
    const result = clearRolls(db, request.scope, request.params.campaignId);
    publishTable(app, request.scope, request.params.campaignId);
    return result;
  });
}
