/** The loop console. GM only, and campaign-scoped like everything else. */
import { deleteRun, getRun, listRuns, saveRun } from '../../store/loop.js';
import { publishTable } from '../../publish.js';

export async function registerLoopRoutes(app) {
  const { db } = app;

  app.get('/campaigns/:campaignId/loop', async (request) => ({
    runs: listRuns(db, request.scope, request.params.campaignId),
  }));

  // A run that has never been saved is not an error: it is a GM opening the
  // console for the first time. The console gets null and starts from the
  // adventure's blank state.
  app.get('/campaigns/:campaignId/loop/:adventureId', async (request) => ({
    run: getRun(db, request.scope, request.params.campaignId, request.params.adventureId),
  }));

  app.put('/campaigns/:campaignId/loop/:adventureId', async (request) => {
    const run = saveRun(
      db, request.scope, request.params.campaignId, request.params.adventureId, request.body ?? {},
    );
    // The room is watching this clock. Advancing a minute on the dashboard has
    // to move it on the television without anybody touching the television.
    publishTable(app, request.scope, request.params.campaignId);
    return { run };
  });

  app.delete('/campaigns/:campaignId/loop/:adventureId', async (request) => {
    const result = deleteRun(
      db, request.scope, request.params.campaignId, request.params.adventureId,
    );
    publishTable(app, request.scope, request.params.campaignId);
    return result;
  });
}
