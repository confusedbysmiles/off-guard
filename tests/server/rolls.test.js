/**
 * The dice log.
 *
 * Two things are worth pinning down: a secret roll never leaves the GM's
 * screen, and a roll made in one campaign never appears in another's.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { freshApp } from './helpers.js';

let app; let db; let world;

beforeEach(async () => { ({ app, db, world } = await freshApp()); });
afterEach(async () => { await app.close(); db.close(); });

const gm = (method, path, body) => app.inject({
  method, url: `/api/gm/${world.gmToken}${path}`, payload: body,
});

const rollIn = (campaignId, body) => gm('POST', `/campaigns/${campaignId}/rolls`, body);

describe('rolling', () => {
  it('rolls, logs and returns the result', async () => {
    const res = await rollIn(world.tuesday.campaign.id, {
      expression: '2d6+3', label: 'Goblin A, jaws',
    });
    expect(res.statusCode).toBe(201);
    const { roll } = res.json();
    expect(roll.expression).toBe('2d6+3');
    expect(roll.label).toBe('Goblin A, jaws');
    expect(roll.total).toBeGreaterThanOrEqual(5);
    expect(roll.total).toBeLessThanOrEqual(15);
    expect(roll.detail.terms[0].rolls).toHaveLength(2);
  });

  it('refuses an expression it cannot read, and says which piece', async () => {
    const res = await rollIn(world.tuesday.campaign.id, { expression: '2d7' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/d7/);
  });

  it('lists the log newest first', async () => {
    await rollIn(world.tuesday.campaign.id, { expression: '1d20', label: 'first' });
    await rollIn(world.tuesday.campaign.id, { expression: '1d20', label: 'second' });
    const { rolls } = (await gm('GET', `/campaigns/${world.tuesday.campaign.id}/rolls`)).json();
    expect(rolls.map((r) => r.label)).toEqual(['second', 'first']);
  });

  it('clears the log', async () => {
    await rollIn(world.tuesday.campaign.id, { expression: '1d20' });
    await gm('DELETE', `/campaigns/${world.tuesday.campaign.id}/rolls`);
    const { rolls } = (await gm('GET', `/campaigns/${world.tuesday.campaign.id}/rolls`)).json();
    expect(rolls).toEqual([]);
  });
});

describe('halving and doubling', () => {
  it('records the derived total as its own entry', async () => {
    const { roll } = (await rollIn(world.tuesday.campaign.id, { expression: '2d6+3' })).json();
    const res = await gm('POST', `/campaigns/${world.tuesday.campaign.id}/rolls/${roll.id}/double`);
    expect(res.statusCode).toBe(201);
    const doubled = res.json().roll;
    expect(doubled.total).toBe(roll.total * 2);
    expect(doubled.derivedFrom).toBe(roll.id);
    expect(doubled.derivation).toBe('double');
  });

  it('halves rounding down', async () => {
    const { roll } = (await rollIn(world.tuesday.campaign.id, { expression: '1d20' })).json();
    const halved = (await gm('POST', `/campaigns/${world.tuesday.campaign.id}/rolls/${roll.id}/half`))
      .json().roll;
    expect(halved.total).toBe(Math.floor(roll.total / 2));
  });

  it('refuses anything but half and double', async () => {
    const { roll } = (await rollIn(world.tuesday.campaign.id, { expression: '1d20' })).json();
    const res = await gm('POST', `/campaigns/${world.tuesday.campaign.id}/rolls/${roll.id}/triple`);
    expect(res.statusCode).toBe(403);
  });

  it('cannot derive from another campaign’s roll', async () => {
    const { roll } = (await rollIn(world.saturday.campaign.id, { expression: '1d20' })).json();
    const res = await gm('POST', `/campaigns/${world.tuesday.campaign.id}/rolls/${roll.id}/double`);
    expect(res.statusCode).toBe(404);
  });
});

describe('what the table sees', () => {
  const tableView = (token) => app.inject({ method: 'GET', url: `/api/table/${token}` });

  it('shows an open roll', async () => {
    await rollIn(world.tuesday.campaign.id, { expression: '1d20+9', label: 'Perception' });
    const body = (await tableView(world.tuesday.tableToken)).json();
    expect(body.rolls.map((r) => r.label)).toContain('Perception');
  });

  it('does not show a secret roll, or leave a gap where one was', async () => {
    await rollIn(world.tuesday.campaign.id, { expression: '1d20', label: 'open' });
    await rollIn(world.tuesday.campaign.id, { expression: '1d20', label: 'hidden', secret: true });
    const body = (await tableView(world.tuesday.tableToken)).json();
    expect(body.rolls.map((r) => r.label)).toEqual(['open']);
    expect(JSON.stringify(body)).not.toMatch(/hidden/);
  });

  it('keeps a derived roll as secret as the one it came from', async () => {
    const { roll } = (await rollIn(world.tuesday.campaign.id, {
      expression: '2d6+3', label: 'sneak attack', secret: true,
    })).json();
    await gm('POST', `/campaigns/${world.tuesday.campaign.id}/rolls/${roll.id}/double`);
    const body = (await tableView(world.tuesday.tableToken)).json();
    expect(body.rolls).toEqual([]);
  });

  it('never shows another campaign’s rolls', async () => {
    await rollIn(world.saturday.campaign.id, { expression: '1d20', label: 'kingmaker roll' });
    const body = (await tableView(world.tuesday.tableToken)).json();
    expect(body.rolls.map((r) => r.label)).not.toContain('kingmaker roll');
  });

  it('shows the total but not the individual dice', async () => {
    await rollIn(world.tuesday.campaign.id, { expression: '2d6+3', label: 'jaws' });
    const [roll] = (await tableView(world.tuesday.tableToken)).json().rolls;
    expect(roll.total).toBeGreaterThan(0);
    expect(roll).not.toHaveProperty('detail');
  });
});

describe('who may roll', () => {
  it('refuses a character token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/gm/${world.tuesday.characterToken}/campaigns/${world.tuesday.campaign.id}/rolls`,
      payload: { expression: '1d20' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses a table token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/gm/${world.tuesday.tableToken}/campaigns/${world.tuesday.campaign.id}/rolls`,
      payload: { expression: '1d20' },
    });
    expect(res.statusCode).toBe(404);
  });
});
