/**
 * Creature search and stat blocks.
 *
 * The catalogue is global across campaigns, so nothing here takes a campaign
 * id. That is deliberate rather than an oversight: monster data belongs to the
 * GM, not to a table, and the GM token is the only one that reaches these
 * routes at all.
 */
import { adjustCreature, scaleCreature } from '../../../rules/index.js';

const asArray = (value) => {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : String(value).split(',').map((s) => s.trim()).filter(Boolean);
};

const asNumber = (value) => (value === undefined || value === '' ? null : Number(value));

/**
 * Apply the GM's adjustments to a stat block.
 *
 * Scaling first, then elite or weak, so the hit-point band is read from the
 * scaled level -- which is the order the rules imply and the order the tests
 * pin down.
 */
export function present(creature, { scale = 0, adjustment = null } = {}) {
  let result = creature;
  if (scale) result = scaleCreature(result, Number(scale));
  if (adjustment === 'elite' || adjustment === 'weak') result = adjustCreature(result, adjustment);
  return result;
}

export async function registerCatalogueRoutes(app) {
  const { catalogue } = app;

  app.get('/catalogue', async () => catalogue.stats());

  app.get('/catalogue/traits', async () => ({
    traits: catalogue.traits(),
    sources: catalogue.sources(),
  }));

  app.get('/catalogue/search', async (request) => {
    const query = request.query ?? {};
    return catalogue.search({
      q: query.q ?? '',
      levelMin: asNumber(query.levelMin),
      levelMax: asNumber(query.levelMax),
      traits: asArray(query.traits),
      rarity: query.rarity || null,
      size: query.size || null,
      creatureType: query.creatureType || null,
      source: query.source || null,
      kind: query.kind || 'creature',
      includeSuperseded: query.includeSuperseded === 'true',
      sort: query.sort || 'level',
      limit: Math.min(Number(query.limit ?? 50), 200),
      offset: Number(query.offset ?? 0),
    });
  });

  app.get('/catalogue/:id', async (request, reply) => {
    const creature = catalogue.get(request.params.id);
    if (!creature) {
      reply.status(404);
      return { error: 'No such creature' };
    }
    const scale = Number(request.query?.scale ?? 0);
    const adjustment = request.query?.adjustment ?? null;
    return { creature: present(creature, { scale, adjustment }) };
  });
}
