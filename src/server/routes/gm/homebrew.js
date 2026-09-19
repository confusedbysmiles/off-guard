/**
 * The options this table wrote. GM only, and campaign-scoped.
 *
 * The lookups handed to the store are the catalogue as this campaign sees it,
 * homebrew included -- so a heritage can belong to an ancestry the GM wrote
 * last week, and a class can advance like one. Built per request rather than
 * once at registration for exactly that reason: which options exist depends on
 * which campaign is asking.
 *
 * They are passed into the store rather than imported by it so that the rules
 * module stays arithmetic over data it was given, which is what makes it
 * testable without a data build.
 */
import {
  createHomebrew, deleteHomebrew, homebrewUsage, listHomebrew, updateHomebrew,
} from '../../store/homebrew.js';
import { campaignFor } from '../../scope.js';

export async function registerHomebrewRoutes(app) {
  const { db } = app;

  /**
   * The three questions building a record asks of the catalogue.
   *
   * Narrow on purpose: this is the only door between a form the GM filled in
   * and 17,000 rows of published content, and a wider one would invite the
   * record builder to start copying fields nobody checked.
   */
  const lookUpsFor = (campaignId) => {
    const options = app.optionsFor(campaignId);
    const ofKind = (kind) => (id) => {
      const record = id ? options.get(String(id)) : null;
      return record?.kind === kind ? record : null;
    };
    return {
      classOf: ofKind('class'),
      ancestryOf: ofKind('ancestry'),
      progressionOf: (id) => options.progressionFor(id),
    };
  };

  app.get('/campaigns/:campaignId/homebrew', async (request) => {
    const entries = listHomebrew(db, request.scope, request.params.campaignId);
    const campaignId = campaignFor(request.scope, request.params.campaignId);
    return {
      // How many characters have chosen each, so the GM can see what a delete
      // would touch before they reach for it.
      homebrew: entries.map((entry) => ({
        ...entry, usedBy: homebrewUsage(db, campaignId, entry.id),
      })),
    };
  });

  /**
   * What a new option can be built on: the ancestry a heritage belongs to, and
   * the class whose advancement table a new class copies.
   *
   * Names and ids only. The form is a pair of selects, and shipping the
   * records behind sixty ancestries so the GM can pick one from a list would be
   * two megabytes to fill in a dropdown.
   */
  app.get('/campaigns/:campaignId/homebrew/bases', async (request) => {
    const campaignId = campaignFor(request.scope, request.params.campaignId);
    listHomebrew(db, request.scope, request.params.campaignId); // the GM check
    const options = app.optionsFor(campaignId);
    const named = (row) => ({ id: row.id, name: row.name, homebrew: Boolean(row.homebrew) });
    return {
      classes: options.search({ kind: 'class', limit: 200, sort: 'name' }).rows.map(named),
      ancestries: options.search({ kind: 'ancestry', limit: 200, sort: 'name' }).rows.map(named),
    };
  });

  app.post('/campaigns/:campaignId/homebrew', async (request, reply) => {
    const campaignId = campaignFor(request.scope, request.params.campaignId);
    const entry = createHomebrew(
      db, request.scope, request.params.campaignId, request.body ?? {}, lookUpsFor(campaignId),
    );
    reply.status(201);
    return { homebrew: entry };
  });

  app.patch('/campaigns/:campaignId/homebrew/:id', async (request) => {
    const campaignId = campaignFor(request.scope, request.params.campaignId);
    return {
      homebrew: updateHomebrew(
        db, request.scope, request.params.campaignId, request.params.id,
        request.body ?? {}, lookUpsFor(campaignId),
      ),
    };
  });

  app.delete('/campaigns/:campaignId/homebrew/:id', async (request) => deleteHomebrew(
    db, request.scope, request.params.campaignId, request.params.id,
  ));
}
