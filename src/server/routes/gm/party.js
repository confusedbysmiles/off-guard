/**
 * The party panel and the encounter budget.
 *
 * Both read the character sheets rather than a stored summary, so what the GM
 * sees and what the player is looking at cannot drift apart.
 */
import { priceEncounter, repriceEncounter } from '../../../rules/index.js';
import { partyFor } from '../../party.js';
import { getEncounter } from '../../store/encounters.js';
import { present } from './catalogue.js';

/**
 * Turn an encounter's rows into the shape the budget wants: the *adjusted*
 * level of each creature, because elite and level scaling change what it costs.
 */
function pricedLines(catalogue, encounter) {
  return encounter.creatures.map((row) => {
    const base = catalogue.get(row.creatureId);
    if (!base) {
      return {
        creatureId: row.creatureId,
        name: row.displayName || row.creatureId,
        count: row.count,
        level: null,
        missing: true,
      };
    }
    const adjusted = present(base, { scale: row.levelScale, adjustment: row.adjustment });
    return {
      creatureId: row.creatureId,
      name: row.displayName || adjusted.name,
      baseName: base.name,
      count: row.count,
      level: adjusted.level,
      baseLevel: base.level,
      adjustment: row.adjustment,
      levelScale: row.levelScale,
      missing: false,
    };
  });
}

export async function registerPartyRoutes(app) {
  const { db, catalogue } = app;

  app.get('/campaigns/:campaignId/party', async (request) => partyFor(
    db, request.scope, request.params.campaignId,
  ));

  /**
   * What an encounter costs.
   *
   * Party level and size come from the sheets, not from a counter the GM has to
   * keep in sync, unless the encounter carries an override for a one-shot.
   */
  app.get('/campaigns/:campaignId/encounters/:encounterId/budget', async (request) => {
    const encounter = getEncounter(
      db, request.scope, request.params.encounterId, request.params.campaignId,
    );
    const party = partyFor(db, request.scope, request.params.campaignId);

    const partyLevel = encounter.partyLevelOverride ?? party.effectiveLevel;
    const partySize = encounter.partySizeOverride ?? party.size;
    const lines = pricedLines(catalogue, encounter);
    const priced = priceEncounter(lines.filter((l) => !l.missing), { partyLevel, partySize });

    return {
      ...priced,
      missing: lines.filter((l) => l.missing),
      overridden: {
        level: encounter.partyLevelOverride !== null,
        size: encounter.partySizeOverride !== null,
      },
      party: { size: party.size, effectiveLevel: party.effectiveLevel, levelDisagrees: party.levelDisagrees },
    };
  });

  /**
   * Price an arbitrary list against a party, for the builder before anything is
   * saved. Takes creature ids and adjustments, never levels the client made up.
   */
  app.post('/campaigns/:campaignId/price', async (request) => {
    const party = partyFor(db, request.scope, request.params.campaignId);
    const body = request.body ?? {};
    const partyLevel = body.partyLevel ?? party.effectiveLevel;
    const partySize = body.partySize ?? party.size;

    const lines = (body.creatures ?? []).map((row) => {
      const base = catalogue.get(row.creatureId);
      if (!base) return { ...row, level: null, missing: true };
      const adjusted = present(base, { scale: row.levelScale ?? 0, adjustment: row.adjustment ?? null });
      return {
        creatureId: row.creatureId,
        name: row.displayName || adjusted.name,
        count: row.count ?? 1,
        level: adjusted.level,
        baseLevel: base.level,
        adjustment: row.adjustment ?? null,
        levelScale: row.levelScale ?? 0,
        missing: false,
      };
    });

    return {
      ...priceEncounter(lines.filter((l) => !l.missing), { partyLevel, partySize }),
      missing: lines.filter((l) => l.missing),
      party: { size: party.size, effectiveLevel: party.effectiveLevel },
    };
  });

  /** What copying an encounter to another campaign would do to its difficulty. */
  app.get('/campaigns/:campaignId/encounters/:encounterId/reprice', async (request) => {
    const encounter = getEncounter(
      db, request.scope, request.params.encounterId, request.params.campaignId,
    );
    const from = partyFor(db, request.scope, request.params.campaignId);
    const to = partyFor(db, request.scope, request.query.toCampaignId);
    const lines = pricedLines(catalogue, encounter).filter((l) => !l.missing);

    return {
      ...repriceEncounter(
        lines,
        { partyLevel: from.effectiveLevel, partySize: from.size },
        { partyLevel: to.effectiveLevel, partySize: to.size },
      ),
      fromCampaign: from.campaign,
      toCampaign: to.campaign,
    };
  });
}
