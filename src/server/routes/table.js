/**
 * The shared initiative screen. Read-only, one campaign.
 *
 * There is no write route in this file and no scope check to forget: every
 * mutating store function calls `assertWritable`, which refuses a table scope
 * outright.
 */
import { tableView } from '../store/combat.js';
import { getCampaign } from '../store/campaigns.js';

export async function registerTableRoutes(app) {
  const { db } = app;

  app.get('/', async (request) => {
    const campaign = getCampaign(db, request.scope);
    return {
      campaign: { id: campaign.id, name: campaign.name, accentColor: campaign.accentColor },
      ...tableView(db, request.scope),
    };
  });
}
