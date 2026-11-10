/**
 * Handouts, from the GM's side.
 *
 * Upload is a raw body rather than a multipart form, which is why there is no
 * new dependency here: the browser sends the file as the request body with its
 * own content type, and the title and filename ride in the query string. A
 * multipart parser would be a dependency carried forever for one upload box.
 */
import {
  ALLOWED_TYPES, createHandout, deleteHandout, listHandouts, MAX_BYTES,
  readHandout, renameHandout, setReleased,
} from '../../store/handouts.js';
import { sendHandout } from '../../handouts.js';

export async function registerHandoutRoutes(app) {
  const { db } = app;

  app.get('/campaigns/:campaignId/handouts', async (request) => ({
    handouts: listHandouts(db, request.scope, request.params.campaignId),
    limits: { maxBytes: MAX_BYTES, types: [...ALLOWED_TYPES.keys()] },
  }));

  app.post('/campaigns/:campaignId/handouts', {
    // Only this route takes a file, so only this route lifts the limit.
    bodyLimit: MAX_BYTES + 1024,
  }, async (request, reply) => {
    const handout = createHandout(db, request.scope, request.params.campaignId, {
      bytes: request.body,
      contentType: request.headers['content-type'],
      filename: request.query?.filename,
      title: request.query?.title,
    });
    reply.status(201);
    return { handout };
  });

  /** The file itself. The GM may read one before releasing it, to check it. */
  app.get('/campaigns/:campaignId/handouts/:handoutId/file', async (request, reply) => {
    const row = readHandout(db, request.scope, request.params.handoutId, request.params.campaignId);
    return sendHandout(reply, row);
  });

  app.patch('/campaigns/:campaignId/handouts/:handoutId', async (request) => {
    const { title, released } = request.body ?? {};
    let handout = null;
    if (typeof title === 'string') {
      handout = renameHandout(
        db, request.scope, request.params.campaignId, request.params.handoutId, title,
      );
    }
    if (typeof released === 'boolean') {
      handout = setReleased(
        db, request.scope, request.params.campaignId, request.params.handoutId, released,
      );
    }
    return { handout };
  });

  app.delete('/campaigns/:campaignId/handouts/:handoutId', async (request) => deleteHandout(
    db, request.scope, request.params.campaignId, request.params.handoutId,
  ));
}
