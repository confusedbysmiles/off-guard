/**
 * Dashboard state.
 *
 * A single object with subscribers, rather than a framework. What the dashboard
 * needs is one selected campaign, one selected encounter and a notification
 * when either changes; anything more elaborate would be scaffolding.
 *
 * The selected campaign is mirrored into the URL fragment so a reload, and the
 * browser's own back button, land where the GM left off. The token stays in the
 * path and never enters the fragment.
 */
const listeners = new Set();

const state = {
  campaigns: [],
  campaignId: null,
  tab: 'table',
  party: null,
  encounters: [],
  encounterId: null,
  encounter: null,
  budget: null,
  combat: null,
  overview: [],
  searchResults: null,
  catalogue: null,
  vocabulary: { traits: [], sources: [] },
  error: null,

  // The drawer: reference, dice and Recall Knowledge. It lives outside `#main`
  // in the DOM and re-renders on its own, so a dashboard re-render does not
  // close a table the GM is reading from.
  drawer: { open: false, tab: 'reference', entryId: null, query: '' },
  reference: null,
  rolls: [],
  recall: null,
  tokens: null,
  sessions: [],

  // The loop console. `loopRun` is what the server last returned -- null until
  // this campaign has saved one -- and `loopState` is what the GM is editing.
  // Kept apart so an unsaved console still renders after a failed write.
  loopAdventure: null,
  loopRun: null,
  loopState: null,
};

export function subscribe(listener) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function get() { return state; }

export function set(patch) {
  Object.assign(state, patch);
  for (const listener of listeners) listener(state);
}

export function currentCampaign() {
  return state.campaigns.find((c) => c.id === state.campaignId) ?? null;
}

/** `#/campaign/3/encounters/7` */
export function readLocation() {
  const parts = (location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean);
  const out = { campaignId: null, tab: null, encounterId: null };
  if (parts[0] === 'campaign' && parts[1]) out.campaignId = Number(parts[1]);
  if (parts[2]) out.tab = parts[2];
  if (parts[3]) out.encounterId = Number(parts[3]);
  return out;
}

export function writeLocation({ campaignId, tab, encounterId }) {
  const parts = ['', 'campaign', campaignId, tab];
  if (encounterId) parts.push(encounterId);
  const next = parts.filter((p) => p !== null && p !== undefined).join('/');
  if (location.hash !== `#${next}`) history.replaceState(null, '', `#${next}`);
}
