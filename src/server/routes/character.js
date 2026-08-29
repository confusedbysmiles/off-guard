/**
 * A player's API. One character, in one campaign.
 *
 * No route here takes a character id. The token names the character, so there
 * is nothing for a client to forge -- the closest it can get is asking for its
 * own sheet.
 */
import { applyPatch, getOwnCharacter, versionsFor } from '../store/characters.js';
import { getCampaign } from '../store/campaigns.js';
import { diffImport, mapPathbuilder } from '../../shared/pathbuilder.js';
import { fetchBuild, fetchEnabled } from '../pathbuilder-fetch.js';

export async function registerCharacterRoutes(app) {
  const { db } = app;

  app.get('/', async (request) => {
    const character = getOwnCharacter(db, request.scope);
    const campaign = getCampaign(db, request.scope);
    return {
      character,
      versions: versionsFor(db, character.id),
      // Enough campaign context to theme the sheet and name the table, and
      // nothing about the other players.
      campaign: { id: campaign.id, name: campaign.name, accentColor: campaign.accentColor },
    };
  });

  app.patch('/', async (request) => applyPatch(
    db, request.scope, request.scope.characterId, request.body?.writes ?? [], { by: 'player' },
  ));

  /**
   * What an import would do. Nothing is written here -- the player sees the
   * diff and confirms it, and only then does `apply` run.
   */
  app.post('/import/preview', async (request, reply) => {
    const { buildId = null, json = null } = request.body ?? {};
    const exported = json ?? (buildId === null ? null : await fetchBuild(buildId));
    if (!exported) {
      reply.status(400);
      return { error: 'Give a Pathbuilder build id or upload its JSON export.' };
    }

    const { sheet, warnings } = mapPathbuilder(exported);
    const current = getOwnCharacter(db, request.scope).sheet;
    return { sheet, warnings, changes: diffImport(current, sheet) };
  });

  /**
   * Apply the changes the player accepted, and only those. The client sends
   * back the subset it wants rather than the whole imported sheet, so
   * unchecking a row in the diff genuinely leaves that field alone.
   */
  app.post('/import/apply', async (request) => {
    const changes = request.body?.changes ?? [];
    const writes = changes
      .filter((change) => typeof change?.path === 'string')
      .map((change) => ({ path: change.path, value: change.to }));
    return applyPatch(db, request.scope, request.scope.characterId, writes, { by: 'import' });
  });

  app.get('/import/capabilities', async () => ({
    fileUpload: true,
    buildId: fetchEnabled(),
    // Said plainly so the interface can explain the situation rather than just
    // failing when someone pastes an id.
    buildIdNote: fetchEnabled()
      ? 'Pathbuilder sits behind a bot check that often blocks servers. If the id fails, use its JSON export.'
      : 'Switched off on this server.',
  }));
}
