/**
 * A player's API. One character, in one campaign.
 *
 * No route here takes a character id. The token names the character, so there
 * is nothing for a client to forge -- the closest it can get is asking for its
 * own sheet.
 */
import { applyPatch, getOwnCharacter, versionsFor } from '../store/characters.js';
import { getCampaign } from '../store/campaigns.js';
import { diffImport, mapPathbuilder, readPath } from '../../shared/pathbuilder.js';
import { exportCharacter, isPortable, readPortable } from '../../shared/portable.js';
import { builderState, buildWrites, startingBuild, validBuild } from '../builder.js';
import { buildFromImport, checkAgainst } from '../../rules/character/from-import.js';
import { isDerivedPath } from '../../rules/character/derive.js';
import { checkChoice, fillSlot } from '../../rules/character/choose.js';
import { searchRows } from '../options.js';
import { fetchBuild, fetchEnabled } from '../pathbuilder-fetch.js';
import { characterChannel, streamTo } from '../events.js';

const asArray = (value) => {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : String(value).split(',').map((s) => s.trim()).filter(Boolean);
};

const asNumber = (value) => (value === undefined || value === '' ? null : Number(value));

/**
 * A catalogue record by its printed name.
 *
 * What an import has is what a book prints -- "Fey-Touched Gnome", "Codebreaker"
 * -- and what a build stores is an id. Exact match, case-insensitive, and
 * nothing cleverer: a near match would silently make somebody a different
 * ancestry, and "we could not find it" is an answer the player can act on
 * whereas "we found something else" is not.
 *
 * Homebrew comes through this too, because `options` is the campaign's view --
 * so a table that wrote its own ancestry can import a character who has it.
 */
function byName(options, kind, name) {
  const needle = String(name ?? '').trim().toLowerCase();
  if (!needle) return null;
  const { rows } = options.search({
    kind: kind === 'equipment' ? null : kind,
    itemType: kind === 'equipment' ? 'armor' : null,
    q: needle,
    limit: 50,
  });
  const match = rows.find((row) => row.name.toLowerCase() === needle);
  return match ? options.get(match.id) : null;
}

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
   * The character as a file they can keep.
   *
   * A copy of their own, independent of this server's backups and of whether
   * this server is still running. It carries no token -- see `exportCharacter`
   * -- so it is a thing a player can email themselves without emailing their
   * link to themselves at the same time.
   */
  app.get('/export', async (request) => exportCharacter(getOwnCharacter(db, request.scope)));

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
    // An empty box is "nothing given", not a malformed id.
    const wanted = String(buildId ?? '').trim();
    const exported = json ?? (wanted ? await fetchBuild(wanted) : null);
    if (!exported) {
      reply.status(400);
      return { error: 'Give a Pathbuilder build id or upload its JSON export.' };
    }

    const current = getOwnCharacter(db, request.scope).sheet;
    const options = app.optionsFor(request.scope.campaignId);

    /**
     * One of ours, restored rather than imported.
     *
     * Nothing to map and nothing to work out: the file holds a sheet this
     * application wrote, and the build inside it is the character's actual
     * build rather than a reconstruction of one. So it goes through the same
     * dialog -- a diff, row by row, nothing silent -- and skips every step
     * that exists to cope with somebody else's format.
     */
    if (isPortable(exported)) {
      const restored = readPortable(exported);
      if (restored.error) {
        reply.status(400);
        return { error: restored.error };
      }

      const { build = null, ...values } = restored.sheet;
      // Play state included: this file is the character as they were, and
      // restoring one to full health would be restoring somebody else.
      const changes = diffImport(current, values, { includePlayState: true });

      return {
        sheet: values,
        warnings: [],
        changes,
        withoutBuild: changes,
        restore: { name: restored.name, exportedAt: restored.exportedAt },
        builder: build
          ? {
            build,
            notes: [],
            differences: [],
            // Nothing was inferred, so there is nothing that could disagree.
            exact: true,
            summary: (() => {
              const state = builderState(options, build);
              return {
                level: state.level,
                ancestry: state.sheet.ancestry,
                heritage: state.sheet.heritage,
                background: state.sheet.background,
                class: state.sheet.class,
                outstanding: state.outstanding,
              };
            })(),
          }
          : null,
      };
    }

    const { sheet, warnings } = mapPathbuilder(exported);

    /**
     * The same file, read a second way: as the choices that would have
     * produced it.
     *
     * An import that writes a sheet and leaves the builder empty makes an
     * imported character and a built one two different kinds of thing, and the
     * application then disagrees with itself about who owns the numbers. So
     * the export is also reconstructed into a build, and what the player is
     * shown is what will actually be on the sheet afterwards: the build's own
     * derivation for everything the build determines, and the file's values
     * for everything else.
     */
    const { build, notes } = buildFromImport(exported, {
      sheet,
      find: (kind, name) => byName(options, kind, name),
    });
    const state = builderState(options, build);

    const derived = buildWrites(build, state, current).filter((write) => write.path !== 'build');
    const fromFile = diffImport(current, sheet)
      .filter((change) => !isDerivedPath(change.path, build));
    const changes = [
      ...fromFile,
      ...derived.map((write) => ({
        path: write.path,
        from: readPath(current, write.path) ?? null,
        to: write.value,
        isNew: readPath(current, write.path) === undefined,
        fromBuild: true,
      })),
    ].sort((a, b) => a.path.localeCompare(b.path));

    return {
      sheet,
      warnings,
      changes,
      /**
       * The same import with the reconstruction declined: the file's own
       * values, and no build.
       *
       * Both lists rather than one, because the choice changes what is
       * written -- a build's derivation of Perception is not the number in the
       * file when the two disagree -- and a diff that does not match what the
       * button will do is worse than no diff.
       */
      withoutBuild: diffImport(current, sheet),
      builder: {
        build,
        notes,
        // Where the reconstruction and the file disagree. Shown, never hidden:
        // only the player can say whether a difference matters.
        differences: checkAgainst(sheet, state.sheet),
        summary: {
          level: state.level,
          ancestry: state.sheet.ancestry,
          heritage: state.sheet.heritage,
          background: state.sheet.background,
          class: state.sheet.class,
          outstanding: state.outstanding,
        },
      },
    };
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

    /**
     * The build document, when the player kept it.
     *
     * Written alongside rather than instead: the sheet writes above are what
     * the preview showed, and this is what makes the builder agree with them.
     * Sent back by the client like the changes are, and no more trusted than
     * the builder's own save, which takes a build from the same place.
     */
    const build = request.body?.build ?? null;
    if (build && validBuild(build)) writes.push({ path: 'build', value: build });

    return applyPatch(db, request.scope, request.scope.characterId, writes, { by: 'import' });
  });

  /**
   * The builder's own catalogue search.
   *
   * Scoped to the player's token like everything else here. Most of what comes
   * back is global -- rules out of a book belong to nobody -- but a campaign's
   * own options are laid over the catalogue for the campaign the token resolved
   * to, so a player sees their table's homebrew and no other table's. The
   * campaign id is never a parameter; see `optionsFor`.
   *
   * The filters are the slot's, passed through -- see `slotsFor`, which is what
   * decides that a level 6 class feat means
   * `category=class&trait=fighter&maxLevel=6`.
   */
  app.get('/builder/options', async (request) => {
    const query = request.query ?? {};
    return app.optionsFor(request.scope.campaignId).search({
      q: query.q ?? '',
      kind: query.kind || null,
      category: query.category || null,
      categories: asArray(query.categories),
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
    const option = app.optionsFor(request.scope.campaignId).get(request.params.id);
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
    const build = character.sheet?.build ?? startingBuild(character.sheet);
    const options = app.optionsFor(request.scope.campaignId);
    return {
      ...builderState(options, build),
      catalogue: options.stats(),
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
    const options = app.optionsFor(request.scope.campaignId);
    if (!options.available) {
      reply.status(503);
      return { error: options.reason };
    }

    const character = getOwnCharacter(db, request.scope);
    const build = request.body.build;
    const state = builderState(options, build);
    const writes = buildWrites(build, state, character.sheet ?? {});

    const result = applyPatch(db, request.scope, request.scope.characterId, writes, { by: 'builder' });
    return { ...result, builder: state };
  });

  /**
   * Fill one slot, checked.
   *
   * `PATCH /builder` takes a whole build document and trusts it, which is
   * right for the builder page: its picker only ever offers legal choices, so
   * there is nothing left to check by the time anything is sent. A caller that
   * is not a picker has plenty -- a model choosing from a list it was given a
   * minute ago will pick a feat this character cannot take, confidently, and
   * the slot filters are advisory until something enforces them.
   *
   * So this is the narrow door: one slot, one value, refused with a reason
   * that says what would have been allowed. The reason matters more than the
   * refusal, because the caller it exists for can read it and try again.
   */
  app.post('/builder/choose', async (request, reply) => {
    const { slotId, value = null } = request.body ?? {};
    const options = app.optionsFor(request.scope.campaignId);
    if (!options.available) {
      reply.status(503);
      return { error: options.reason };
    }

    const character = getOwnCharacter(db, request.scope);
    const build = character.sheet?.build ?? startingBuild(character.sheet);
    const before = builderState(options, build);
    const slot = before.slots.find((s) => s.id === slotId);

    if (!slot) {
      reply.status(400);
      return {
        error: `There is no slot called "${slotId}" on this character.`,
        // The list, because the caller that gets this wrong is the one that
        // can use it: it asked for a slot and should be told which exist.
        slots: before.slots.map((s) => ({ id: s.id, label: s.label, level: s.level })),
      };
    }

    /**
     * Whether the catalogue would have offered this id here.
     *
     * Answered by running the slot's own filter over the one row, so it is
     * the same predicate the picker searches with rather than a second
     * reading of it. A filter that changes changes both at once.
     */
    const offers = (which, id) => {
      const row = (options.rows ?? []).find((r) => r.id === id);
      if (!row) return `There is no option with the id "${id}".`;
      if (!which.filter) return true;
      if (searchRows([row], { ...which.filter, limit: 1 }).total) return true;
      return `${row.name} is not something ${which.label} offers.`;
    };

    const wrong = checkChoice(slot, value, { offers });
    if (wrong) {
      reply.status(400);
      return { error: wrong, slot: { id: slot.id, label: slot.label, kind: slot.kind } };
    }

    const next = fillSlot(build, slot, value);
    const state = builderState(options, next);
    const writes = buildWrites(next, state, character.sheet ?? {});
    applyPatch(db, request.scope, request.scope.characterId, writes, { by: 'builder' });

    return { chose: { slot: slot.id, value }, builder: state };
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
