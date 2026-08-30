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
import { blankBuild, builderState, buildWrites, validBuild } from '../builder.js';
import { fetchBuild, fetchEnabled } from '../pathbuilder-fetch.js';
import { characterChannel, streamTo } from '../events.js';

const asArray = (value) => {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : String(value).split(',').map((s) => s.trim()).filter(Boolean);
};

const asNumber = (value) => (value === undefined || value === '' ? null : Number(value));

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

  /**
   * The live stream, so a condition the GM pushes appears on the player's phone
   * without them refreshing.
   */
  app.get('/stream', async (request, reply) => {
    streamTo(reply, request, {
      bus: app.bus,
      channel: characterChannel(request.scope.characterId),
      snapshot: () => {
        const character = getOwnCharacter(db, request.scope);
        return { character, versions: versionsFor(db, character.id) };
      },
    });
    return reply;
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

  /**
   * The builder's own catalogue search.
   *
   * Scoped to the player's token like everything else here, but the content is
   * global: rules options belong to nobody. The filters are the slot's, passed
   * through -- see `slotsFor`, which is what decides that a level 6 class feat
   * means `category=class&trait=fighter&maxLevel=6`.
   */
  app.get('/builder/options', async (request) => {
    const query = request.query ?? {};
    return app.builderOptions.search({
      q: query.q ?? '',
      kind: query.kind || null,
      category: query.category || null,
      trait: query.trait || null,
      traits: asArray(query.traits),
      maxLevel: asNumber(query.maxLevel),
      minLevel: asNumber(query.minLevel),
      rarity: query.rarity || null,
      tradition: query.tradition || null,
      ancestry: query.ancestry || null,
      itemType: query.itemType || null,
      source: query.source || null,
      skill: query.skill || null,
      remasterOnly: query.remasterOnly === 'true',
      sort: query.sort || 'name',
      limit: Math.min(Number(query.limit ?? 50), 200),
      offset: Number(query.offset ?? 0),
    });
  });

  /** One option in full, with its resolved text. */
  app.get('/builder/options/:id', async (request, reply) => {
    const option = app.builderOptions.get(request.params.id);
    if (!option) {
      reply.status(404);
      return { error: 'No such option' };
    }
    return { option };
  });

  /**
   * The build, the sheet it derives, and the timeline of what is still to
   * choose -- including the levels the player has planned but not reached.
   */
  app.get('/builder', async (request) => {
    const character = getOwnCharacter(db, request.scope);
    const build = character.sheet?.build ?? blankBuild();
    return {
      ...builderState(app.builderOptions, build),
      catalogue: app.builderOptions.stats(),
    };
  });

  /**
   * Save a build.
   *
   * The whole document is sent rather than a delta: it is a few kilobytes, a
   * character has exactly one player, and a partial update would need conflict
   * rules for choices that cannot conflict. What comes back is the new state,
   * so the interface re-renders from the server's derivation rather than its
   * own -- there is one copy of the arithmetic and this is which one wins.
   */
  app.patch('/builder', async (request, reply) => {
    if (!validBuild(request.body?.build)) {
      reply.status(400);
      return { error: 'Send the whole build document.' };
    }
    if (!app.builderOptions.available) {
      reply.status(503);
      return { error: app.builderOptions.reason };
    }

    const character = getOwnCharacter(db, request.scope);
    const build = request.body.build;
    const state = builderState(app.builderOptions, build);
    const writes = buildWrites(build, state, character.sheet ?? {});

    const result = applyPatch(db, request.scope, request.scope.characterId, writes, { by: 'builder' });
    return { ...result, builder: state };
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
