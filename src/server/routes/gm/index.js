/**
 * The GM's API. One token, every campaign.
 *
 * Split by resource rather than kept in one file: the dashboard adds creature
 * search and party statistics on top of what is here, and a single module would
 * have made the campaign-scoping rule harder to see rather than easier.
 */
import { registerCampaignRoutes } from './campaigns.js';
import { registerCharacterAdminRoutes } from './characters.js';
import { registerEncounterRoutes } from './encounters.js';
import { registerInitiativeRoutes } from './initiative.js';
import { registerLinkRoutes } from './links.js';
import { registerCatalogueRoutes } from './catalogue.js';
import { registerPartyRoutes } from './party.js';
import { registerReferenceRoutes } from './reference.js';
import { registerRollRoutes } from './rolls.js';
import { registerSessionRoutes } from './sessions.js';

export async function registerGmRoutes(app) {
  await registerCampaignRoutes(app);
  await registerCharacterAdminRoutes(app);
  await registerEncounterRoutes(app);
  await registerInitiativeRoutes(app);
  await registerLinkRoutes(app);
  await registerCatalogueRoutes(app);
  await registerPartyRoutes(app);
  await registerReferenceRoutes(app);
  await registerRollRoutes(app);
  await registerSessionRoutes(app);
}
