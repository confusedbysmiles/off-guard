/**
 * Mount point for the standalone demo.
 *
 * Inside Off-Guard proper you would do this from the GM dashboard's router
 * instead, and swap localAdapter for an adapter that talks to the campaign
 * API so loop state survives a reload on another device and can be pushed
 * over SSE to the shared screen.
 */
import { ADVENTURE } from './nine-minutes.data.js';
import { localAdapter } from './loop-console.js';

const node = document.getElementById('console');
node.adventure = ADVENTURE;
node.storage = localAdapter('off-guard:loop:' + ADVENTURE.id);

// Example of the integration seam: mirror loop state into the rest of the app.
node.addEventListener('loop-console:reset', (e) => {
  console.info('[loop-console] burned loop %d, now on %d', e.detail.from, e.detail.to);
});
node.addEventListener('loop-console:perfect', (e) => {
  console.info('[loop-console] perfect run on loop %d', e.detail.loop);
});
