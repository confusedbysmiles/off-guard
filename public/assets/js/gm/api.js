/**
 * The dashboard's API client.
 *
 * Thin on purpose. The token comes from the path and is never stored anywhere
 * else; the campaign id is always in the URL rather than a body field, which
 * mirrors how the server scopes the request.
 */
import { apiPath, token } from '../lib/mount.js';

const base = apiPath(`/api/gm/${token}`);

async function request(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const error = new Error(body?.error ?? `Server said ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return body;
}

const query = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '' ) continue;
    search.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const string = search.toString();
  return string ? `?${string}` : '';
};

export const api = {
  me: () => request('/me'),
  campaigns: () => request('/campaigns'),
  overview: () => request('/overview'),
  createCampaign: (fields) => request('/campaigns', { method: 'POST', body: fields }),
  updateCampaign: (id, fields) => request(`/campaigns/${id}`, { method: 'PATCH', body: fields }),
  archiveCampaign: (id, archived) => request(`/campaigns/${id}/archive`, { method: 'POST', body: { archived } }),

  party: (id) => request(`/campaigns/${id}/party`),

  characters: (id) => request(`/campaigns/${id}/characters`),
  createCharacter: (id, fields) =>
    request(`/campaigns/${id}/characters`, { method: 'POST', body: fields }),

  sessions: (id) => request(`/campaigns/${id}/sessions`),
  createSession: (id, fields) =>
    request(`/campaigns/${id}/sessions`, { method: 'POST', body: fields }),
  updateSession: (id, sessionId, fields) =>
    request(`/campaigns/${id}/sessions/${sessionId}`, { method: 'PATCH', body: fields }),
  deleteSession: (id, sessionId) =>
    request(`/campaigns/${id}/sessions/${sessionId}`, { method: 'DELETE' }),

  tokens: (id) => request(`/campaigns/${id}/tokens`),
  mintCharacterToken: (id, characterId) =>
    request(`/campaigns/${id}/tokens/character/${characterId}`, { method: 'POST', body: {} }),
  mintTableToken: (id) => request(`/campaigns/${id}/tokens/table`, { method: 'POST', body: {} }),
  rotateToken: (tokenId) => request(`/tokens/${tokenId}/rotate`, { method: 'POST', body: {} }),

  reference: () => request('/reference'),

  catalogue: () => request('/catalogue'),
  vocabulary: () => request('/catalogue/traits'),
  search: (params) => request(`/catalogue/search${query(params)}`),
  creature: (id, params = {}) => request(`/catalogue/${encodeURIComponent(id)}${query(params)}`),
  recallCreature: (id, params = {}) =>
    request(`/catalogue/${encodeURIComponent(id)}/recall-knowledge${query(params)}`),

  encounters: (id) => request(`/campaigns/${id}/encounters`),
  encounter: (id, encounterId) => request(`/campaigns/${id}/encounters/${encounterId}`),
  createEncounter: (id, fields) => request(`/campaigns/${id}/encounters`, { method: 'POST', body: fields }),
  updateEncounter: (id, encounterId, fields) =>
    request(`/campaigns/${id}/encounters/${encounterId}`, { method: 'PATCH', body: fields }),
  reorderEncounters: (id, order) =>
    request(`/campaigns/${id}/encounters/reorder`, { method: 'POST', body: { order } }),
  deleteEncounter: (id, encounterId) => request(`/campaigns/${id}/encounters/${encounterId}`, { method: 'DELETE' }),
  setCreatures: (id, encounterId, creatures) =>
    request(`/campaigns/${id}/encounters/${encounterId}/creatures`, { method: 'PUT', body: { creatures } }),
  copyEncounter: (id, encounterId, toCampaignId) =>
    request(`/campaigns/${id}/encounters/${encounterId}/copy`, { method: 'POST', body: { toCampaignId } }),
  reprice: (id, encounterId, toCampaignId) =>
    request(`/campaigns/${id}/encounters/${encounterId}/reprice${query({ toCampaignId })}`),

  price: (id, body) => request(`/campaigns/${id}/price`, { method: 'POST', body }),

  combat: (id) => request(`/campaigns/${id}/combat`),
  startCombat: (id, fields) => request(`/campaigns/${id}/combat`, { method: 'POST', body: fields }),
  populate: (id, combatId, body) =>
    request(`/campaigns/${id}/combat/${combatId}/populate`, { method: 'POST', body }),
  addCombatant: (id, combatId, fields) =>
    request(`/campaigns/${id}/combat/${combatId}/combatants`, { method: 'POST', body: fields }),
  updateCombatant: (id, combatantId, fields) =>
    request(`/campaigns/${id}/combat/combatants/${combatantId}`, { method: 'PATCH', body: fields }),
  removeCombatant: (id, combatantId) =>
    request(`/campaigns/${id}/combat/combatants/${combatantId}`, { method: 'DELETE' }),
  damage: (id, combatantId, amount) =>
    request(`/campaigns/${id}/combat/combatants/${combatantId}/damage`, { method: 'POST', body: { amount } }),
  sortInitiative: (id, combatId) =>
    request(`/campaigns/${id}/combat/${combatId}/sort`, { method: 'POST', body: {} }),
  orderCombatants: (id, combatId, order) =>
    request(`/campaigns/${id}/combat/${combatId}/order`, { method: 'POST', body: { order } }),
  advance: (id, combatId, direction) =>
    request(`/campaigns/${id}/combat/${combatId}/advance`, { method: 'POST', body: { direction } }),
  endCombat: (id, combatId) =>
    request(`/campaigns/${id}/combat/${combatId}/end`, { method: 'POST', body: {} }),
  recallCombatant: (id, combatantId, params = {}) =>
    request(`/campaigns/${id}/combat/combatants/${combatantId}/recall-knowledge${query(params)}`),

  rolls: (id, limit = 50) => request(`/campaigns/${id}/rolls${query({ limit })}`),
  roll: (id, body) => request(`/campaigns/${id}/rolls`, { method: 'POST', body }),
  deriveRoll: (id, rollId, derivation) =>
    request(`/campaigns/${id}/rolls/${rollId}/${derivation}`, { method: 'POST', body: {} }),
  clearRolls: (id) => request(`/campaigns/${id}/rolls`, { method: 'DELETE' }),

  tableView: (id) => request(`/campaigns/${id}/table-view`),
  budget: (id, encounterId) => request(`/campaigns/${id}/encounters/${encounterId}/budget`),
};
