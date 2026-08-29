/**
 * Campaigns, and the cross-campaign overview.
 *
 * The campaign id is a path parameter rather than a body field, so the scope of
 * a request is visible in its URL and goes through `campaignFor` on every call.
 */
import {
  archiveCampaign, campaignOverview, createCampaign, getCampaign, listCampaigns, updateCampaign,
} from '../../store/campaigns.js';

export async function registerCampaignRoutes(app) {
  const { db } = app;

  app.get('/campaigns', async (request) => ({
    campaigns: listCampaigns(db, request.scope, { includeArchived: true }),
  }));

  app.get('/overview', async (request) => ({ campaigns: campaignOverview(db, request.scope) }));

  app.post('/campaigns', async (request, reply) => {
    const campaign = createCampaign(db, request.scope, request.body ?? {});
    reply.status(201);
    return { campaign };
  });

  app.get('/campaigns/:campaignId', async (request) => ({
    campaign: getCampaign(db, request.scope, request.params.campaignId),
  }));

  app.patch('/campaigns/:campaignId', async (request) => ({
    campaign: updateCampaign(db, request.scope, request.params.campaignId, request.body ?? {}),
  }));

  app.post('/campaigns/:campaignId/archive', async (request) => ({
    campaign: archiveCampaign(db, request.scope, request.params.campaignId, request.body?.archived ?? true),
  }));
}
