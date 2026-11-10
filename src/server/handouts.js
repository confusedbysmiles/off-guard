/**
 * Serving a handout's bytes.
 *
 * Shared by the GM's route and the player's, because the headers are the
 * security boundary and there must be exactly one copy of them.
 *
 * `X-Content-Type-Options: nosniff` is already on every response, which is the
 * load-bearing one: it stops a browser deciding for itself that a text file is
 * really HTML. On top of that, only the types in `ALLOWED_TYPES` were ever
 * stored, and only PDFs and images are offered inline -- anything else
 * downloads rather than rendering in a tab that shares this origin.
 */
import { ALLOWED_TYPES } from './store/handouts.js';

export function sendHandout(reply, row) {
  const rule = ALLOWED_TYPES.get(row.contentType);
  // A row whose type is no longer allowed downloads rather than renders. The
  // list can only ever get shorter, and shortening it should take effect for
  // things already stored.
  const disposition = rule?.inline ? 'inline' : 'attachment';

  // RFC 5987, so a filename with a comma or an accent survives the trip.
  const ascii = row.filename.replace(/[^\x20-\x7E]+/g, '_').replace(/"/g, '');
  reply.header('Content-Type', row.contentType);
  reply.header(
    'Content-Disposition',
    `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
  );
  reply.header('Content-Length', String(row.size));
  // The bytes never change once uploaded, so a browser may keep them; the
  // path carries a token, so no shared cache may.
  reply.header('Cache-Control', 'private, max-age=3600');
  return reply.send(row.bytes);
}
