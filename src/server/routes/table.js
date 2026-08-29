/**
 * The shared initiative screen. Read-only, one campaign.
 *
 * There is no write route in this file and no scope check to forget: every
 * mutating store function calls `assertWritable`, which refuses a table scope
 * outright.
 */
import { tableView } from '../store/combat.js';
import { getCampaign } from '../store/campaigns.js';
import { campaignChannel, streamTo } from '../events.js';

export async function registerTableRoutes(app) {
  const { db } = app;

  const snapshot = (scope) => {
    const campaign = getCampaign(db, scope);
    return {
      campaign: { id: campaign.id, name: campaign.name, accentColor: campaign.accentColor },
      ...tableView(db, scope),
    };
  };

  app.get('/', async (request) => snapshot(request.scope));

  /**
   * The live stream.
   *
   * Subscribed to this token's own campaign channel, which is the only channel
   * it can reach: the scope was resolved from the token before this handler ran
   * and the campaign id is never taken from the request.
   */
  app.get('/stream', async (request, reply) => {
    streamTo(reply, request, {
      bus: app.bus,
      channel: campaignChannel(request.scope.campaignId),
      snapshot: () => snapshot(request.scope),
    });
    // Fastify must not try to send a body: the response stays open.
    return reply;
  });
}
