/** The session log. GM only, and campaign-scoped like everything else. */
import {
  createSession, deleteSession, listSessions, updateSession,
} from '../../store/sessions.js';

export async function registerSessionRoutes(app) {
  const { db } = app;

  app.get('/campaigns/:campaignId/sessions', async (request) => ({
    sessions: listSessions(db, request.scope, request.params.campaignId, {
      limit: request.query?.limit ?? 100,
    }),
  }));

  app.post('/campaigns/:campaignId/sessions', async (request, reply) => {
    const session = createSession(db, request.scope, request.params.campaignId, request.body ?? {});
    reply.status(201);
    return { session };
  });

  app.patch('/campaigns/:campaignId/sessions/:sessionId', async (request) => ({
    session: updateSession(
      db, request.scope, request.params.campaignId, request.params.sessionId, request.body ?? {},
    ),
  }));

  app.delete('/campaigns/:campaignId/sessions/:sessionId', async (request) => deleteSession(
    db, request.scope, request.params.campaignId, request.params.sessionId,
  ));
}
