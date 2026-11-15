/**
 * The campaign calendar. GM only, and campaign-scoped like everything else.
 *
 * The player's half is a single read on their own route -- see
 * `routes/character.js` -- because a player has one campaign and never names
 * it, and because the only thing they may do here is look.
 */
import {
  createEvent, deleteEvent, readCalendar, setDate, updateEvent,
} from '../../store/calendar.js';
import { publishTable } from '../../publish.js';

export async function registerCalendarRoutes(app) {
  const { db } = app;

  app.get('/campaigns/:campaignId/calendar', async (request) => readCalendar(
    db, request.scope, request.params.campaignId,
  ));

  /**
   * Where the party is. Published to the shared screen, which carries the date
   * beside the clock -- moving the calendar is something the table should see
   * happen rather than find out about later.
   */
  app.put('/campaigns/:campaignId/calendar/date', async (request) => {
    const result = setDate(db, request.scope, request.params.campaignId, request.body?.date ?? null);
    publishTable(app, request.scope, request.params.campaignId);
    return result;
  });

  app.post('/campaigns/:campaignId/calendar/events', async (request, reply) => {
    const event = createEvent(db, request.scope, request.params.campaignId, request.body ?? {});
    if (event.shared) publishTable(app, request.scope, request.params.campaignId);
    reply.status(201);
    return { event };
  });

  app.patch('/campaigns/:campaignId/calendar/events/:eventId', async (request) => {
    const event = updateEvent(
      db, request.scope, request.params.campaignId, request.params.eventId, request.body ?? {},
    );
    publishTable(app, request.scope, request.params.campaignId);
    return { event };
  });

  app.delete('/campaigns/:campaignId/calendar/events/:eventId', async (request) => {
    const result = deleteEvent(
      db, request.scope, request.params.campaignId, request.params.eventId,
    );
    publishTable(app, request.scope, request.params.campaignId);
    return result;
  });
}
