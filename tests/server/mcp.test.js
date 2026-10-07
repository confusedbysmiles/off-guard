/**
 * The MCP server, spoken to the way a client speaks to it.
 *
 * Spawned as a process and driven over stdio, against a real listening server,
 * because every interesting thing about it is at a boundary: the JSON-RPC
 * framing, the HTTP calls, the device cookie it keeps between runs. A test
 * that imported it and called its functions would exercise none of those.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/server/app.js';
import { freshDb, seed } from './helpers.js';
import { listDevices } from '../../src/server/store/devices.js';
import { resolveScope } from '../../src/server/scope.js';

let app; let db; let world; let origin; let statePath;

beforeEach(async () => {
  db = freshDb();
  world = seed(db);
  app = await buildApp({ db, logger: false, limits: { max: 100000 } });
  await app.listen({ host: '127.0.0.1', port: 0 });
  origin = `http://127.0.0.1:${app.server.address().port}`;
  statePath = join(mkdtempSync(join(tmpdir(), 'og-mcp-')), 'device.json');
});

afterEach(async () => { await app.close(); db.close(); });

/** A client: spawn it, speak JSON-RPC, and read the answers. */
function client({ token = world.tuesday.characterToken, state = statePath } = {}) {
  const child = spawn('node', ['tools/mcp-server.js'], {
    env: {
      ...process.env,
      OFF_GUARD_URL: origin,
      OFF_GUARD_TOKEN: token,
      OFF_GUARD_STATE: state,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let next = 1;
  const waiting = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  });

  const rpc = (method, params) => new Promise((done, fail) => {
    const id = next += 1;
    waiting.set(id, done);
    setTimeout(() => fail(new Error(`${method} did not answer`)), 8000);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  return {
    rpc,
    async tool(name, args = {}) {
      const res = await rpc('tools/call', { name, arguments: args });
      const body = res.result?.content?.[0]?.text ?? '';
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* a plain string */ }
      return { isError: Boolean(res.result?.isError), body, parsed };
    },
    stop: () => child.kill(),
  };
}

describe('the protocol', () => {
  it('introduces itself and lists what it can do', async () => {
    const mcp = client();
    const init = await mcp.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    expect(init.result.serverInfo.name).toBe('off-guard');
    expect(init.result.capabilities).toHaveProperty('tools');

    const { result } = await mcp.rpc('tools/list');
    expect(result.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['whoami', 'get_build', 'list_choices', 'choose']),
    );
    // Every tool has to describe itself, or a model cannot choose between them.
    for (const tool of result.tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
    }
    mcp.stop();
  });

  it('says so when asked for a tool it has not got', async () => {
    const mcp = client();
    await mcp.rpc('initialize', { protocolVersion: '2025-06-18' });
    const res = await mcp.rpc('tools/call', { name: 'delete_everything', arguments: {} });
    expect(res.error.message).toMatch(/No tool called/);
    mcp.stop();
  });
});

describe('building a character through it', () => {
  it('fills a slot and derives from it', async () => {
    const mcp = client();
    await mcp.rpc('initialize', { protocolVersion: '2025-06-18' });

    const chose = await mcp.tool('choose', { slotId: 'ancestry', value: 'ancestry:dwarf' });
    expect(chose.isError).toBe(false);
    expect(chose.parsed.nowReads.filled).toBe('Dwarf');

    const who = await mcp.tool('whoami');
    expect(who.parsed.ancestry).toBe('Dwarf');
    mcp.stop();
  });

  it('narrows a slot’s choices to what that slot allows', async () => {
    const mcp = client();
    await mcp.rpc('initialize', { protocolVersion: '2025-06-18' });
    await mcp.tool('choose', { slotId: 'ancestry', value: 'ancestry:dwarf' });

    const heritages = await mcp.tool('list_choices', { slotId: 'heritage', limit: 100 });
    const names = heritages.parsed.options.map((o) => o.id);
    expect(names).toContain('heritage:anvil-dwarf');
    // An elf heritage is not among a dwarf's choices; a versatile one is.
    expect(names).not.toContain('heritage:cavern-elf');
    mcp.stop();
  });

  /**
   * The reason this is defensible rather than a quick way to produce an
   * illegal character. A model will pick a plausible option that does not
   * belong, and the refusal has to reach it as something it can read.
   */
  it('refuses a real option in the wrong slot, as a readable error', async () => {
    const mcp = client();
    await mcp.rpc('initialize', { protocolVersion: '2025-06-18' });

    const wrong = await mcp.tool('choose', { slotId: 'ancestry', value: 'class:fighter' });
    expect(wrong.isError).toBe(true);
    expect(wrong.body).toMatch(/not something Ancestry offers/i);

    // And nothing was written.
    expect((await mcp.tool('whoami')).parsed.ancestry).toBe(null);
    mcp.stop();
  });

  it('refuses an attribute that is not one', async () => {
    const mcp = client();
    await mcp.rpc('initialize', { protocolVersion: '2025-06-18' });
    await mcp.tool('choose', { slotId: 'class', value: 'class:fighter' });

    const wrong = await mcp.tool('choose', { slotId: 'boosts-1', value: ['strength'] });
    expect(wrong.isError).toBe(true);
    expect(wrong.body).toMatch(/not an attribute/i);
    mcp.stop();
  });
});

describe('the device it is', () => {
  const tokenId = () => resolveScope(db, world.tuesday.characterToken).tokenId;

  it('shows up as what it is, not as a browser', async () => {
    const mcp = client();
    await mcp.rpc('initialize', { protocolVersion: '2025-06-18' });
    await mcp.tool('whoami');

    const [device] = listDevices(db, tokenId());
    expect(device.label).toBe('MCP client');
    mcp.stop();
  });

  it('keeps its cookie, so a restart is not a new device', async () => {
    const first = client();
    await first.rpc('initialize', { protocolVersion: '2025-06-18' });
    await first.tool('whoami');
    first.stop();

    expect(existsSync(statePath)).toBe(true);
    // It is a credential, so it is not left world-readable.
    expect(statSync(statePath).mode & 0o077).toBe(0);
    expect(JSON.parse(readFileSync(statePath, 'utf8')).device).toMatch(/^[0-9A-HJ-NP-TV-Z]{26}$/);

    const second = client();
    await second.rpc('initialize', { protocolVersion: '2025-06-18' });
    await second.tool('whoami');
    second.stop();

    expect(listDevices(db, tokenId())).toHaveLength(1);
  });
});
