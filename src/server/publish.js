/**
 * Publishing state changes to whoever is watching.
 *
 * Called from the routes rather than from the store: the store functions take a
 * scope and know nothing about connections, and the route is the layer that
 * already knows which campaign the request was for.
 *
 * Publishing is deliberately noisy -- every mutation republishes the whole
 * table view. It costs a few hundred bytes and removes the entire class of bug
 * where a client's state drifts after a dropped event.
 */
import { campaignChannel, characterChannel } from './events.js';
import { tableView } from './store/combat.js';
import { getCharacter, versionsFor } from './store/characters.js';

export function publishTable(app, scope, campaignId) {
  try {
    app.bus.publish(campaignChannel(campaignId), 'table', tableView(app.db, scope, campaignId));
  } catch (error) {
    // A failed publish must never fail the write that caused it: the change is
    // already committed, and a screen that missed one event gets the next.
    app.log.warn({ err: error }, 'could not publish the table view');
  }
}

export function publishCharacter(app, scope, characterId, campaignId = null) {
  try {
    const character = getCharacter(app.db, scope, characterId, campaignId);
    app.bus.publish(characterChannel(characterId), 'character', {
      character,
      versions: versionsFor(app.db, characterId),
    });
  } catch (error) {
    app.log.warn({ err: error }, 'could not publish the character');
  }
}
