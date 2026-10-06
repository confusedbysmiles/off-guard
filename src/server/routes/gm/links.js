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
import { forgetDevice, listDevices, setLocked } from '../../store/devices.js';

export async function registerLinkRoutes(app) {
  const { db } = app;

  /**
   * Which link this request arrived on.
   *
   * The GM token belongs to no campaign, so it appears in no campaign's
   * listing, and the dashboard would otherwise have no way to name the thing it
   * is running on in order to rotate it. Returns the row's id and nothing that
   * could reconstruct the token.
   */
  app.get('/me', async (request) => ({
    tokenId: request.scope.tokenId,
    kind: request.scope.kind,
    // The GM's own link belongs to no campaign and so appears in no campaign's
    // listing. Its devices arrive here instead, because the one link whose
    // device list is most worth looking at is the one that reaches everything.
    lockedAt: request.scope.lockedAt,
    devices: listDevices(db, request.scope.tokenId),
  }));

  /**
   * The links, each with the devices it has been opened from.
   *
   * The devices come with the listing rather than behind a second request,
   * because the question they answer -- "has anybody else opened this" -- is
   * the reason to look at this panel at all, and one nobody would think to ask
   * if it took a click to find out.
   */
  app.get('/campaigns/:campaignId/tokens', async (request) => {
    const tokens = listTokens(db, request.scope, request.params.campaignId);
    return {
      tokens: tokens.map((token) => ({ ...token, devices: listDevices(db, token.id) })),
      retrievable: false,
    };
  });

  /** Enforcement, per link. Off by default and for every link that exists. */
  app.post('/tokens/:tokenId/lock', async (request) => setLocked(
    db, request.scope, request.params.tokenId, request.body?.locked !== false,
  ));

  /**
   * Forget one device.
   *
   * On an unlocked link, housekeeping. On a locked one, a revocation -- and on
   * the GM's own locked link, a way to lock yourself out of the dashboard that
   * grants devices. `tools/unlock-link.js` is the way back from that, and it
   * needs a shell rather than a link.
   */
  app.delete('/tokens/:tokenId/devices/:deviceId', async (request) => forgetDevice(
    db, request.scope, request.params.tokenId, request.params.deviceId,
  ));

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
