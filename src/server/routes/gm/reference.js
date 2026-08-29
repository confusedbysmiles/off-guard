/**
 * The reference corpus.
 *
 * Global like the catalogue, and read-only, so it takes no campaign id. It is
 * sent as a pre-serialized string with an ETag: the file never changes while
 * the process is running, and a GM who reloads the dashboard should not pay
 * three hundred kilobytes for it every time.
 */
export async function registerReferenceRoutes(app) {
  const { reference } = app;

  app.get('/reference', async (request, reply) => {
    if (request.headers['if-none-match'] === reference.etag) {
      return reply.status(304).send();
    }
    return reply
      .header('etag', reference.etag)
      .header('cache-control', 'no-cache')
      .type('application/json')
      .send(reference.body);
  });
}
