#!/usr/bin/env node
/**
 * Off-Guard over MCP: building a character by talking about it.
 *
 * Runs on the player's own machine and speaks to their Off-Guard over HTTPS --
 * the same requests their browser makes, with the same link. Nothing new
 * listens on the server, and the server makes no outbound call it did not make
 * before.
 *
 * No dependency. MCP over stdio is newline-delimited JSON-RPC 2.0 and four
 * methods of it are enough: `initialize`, `tools/list`, `tools/call` and
 * `ping`. The official SDK is a fine library; this is a hundred lines and this
 * project has four dependencies, which is a thing worth keeping.
 *
 * What makes this defensible rather than a clever way to produce an illegal
 * character: every choice goes through `POST /builder/choose`, which checks it
 * against the slot's own filter and refuses with a reason. A model asked to
 * pick a feat will pick a plausible one that this character cannot take; the
 * refusal says so, and the model can read it and try again. The slots are also
 * what it searches within, so the list it is choosing from is already narrowed
 * to what is legal.
 *
 *   OFF_GUARD_URL    https://offguard.example.com
 *   OFF_GUARD_TOKEN  the character link's token
 *   OFF_GUARD_STATE  where to keep this device's cookie (optional)
 *
 * The token is a credential and lives in the client's configuration, which is
 * a new place for it to live: see the note on device binding in the README.
 * Lock the link to this device once it has connected and a copy of the
 * configuration is no longer a way in.
 */
import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

const PROTOCOL = '2025-06-18';
const NAME = 'off-guard';
const VERSION = '1.0.0';

const base = String(process.env.OFF_GUARD_URL ?? '').replace(/\/+$/, '');
const token = String(process.env.OFF_GUARD_TOKEN ?? '').trim();
const statePath = process.env.OFF_GUARD_STATE
  ?? resolve(homedir(), '.off-guard', 'mcp-device.json');

/**
 * This client's device cookie, kept between runs.
 *
 * Without it every start would look like a new device, and a link locked to
 * the devices it knows would refuse this one the second time. Written 0600:
 * it is a credential, and the only thing stopping a copy of it from being a
 * second factor somebody else holds.
 */
function readDevice() {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8')).device ?? null;
  } catch {
    return null;
  }
}

function writeDevice(secret) {
  try {
    mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
    writeFileSync(statePath, `${JSON.stringify({ device: secret }, null, 2)}\n`, { mode: 0o600 });
  } catch (error) {
    // Not fatal: this session works, and the next one looks like a new device.
    process.stderr.write(`off-guard: could not keep the device cookie (${error.message})\n`);
  }
}

let device = readDevice();

/**
 * One request to Off-Guard.
 *
 * Identifies itself honestly in the user agent, which is what puts "MCP
 * client" rather than "Unknown device" in the GM's Links panel -- the GM
 * should be able to see at a glance that something that is not a browser has
 * opened a player's link.
 */
async function call(path, { method = 'GET', body = null } = {}) {
  const res = await fetch(`${base}/api/c/${token}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      'user-agent': `Off-Guard MCP/${VERSION}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(device ? { cookie: `og_device=${device}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = res.headers.get('set-cookie');
  const issued = setCookie?.match(/og_device=([^;]+)/)?.[1];
  if (issued && issued !== device) {
    device = issued;
    writeDevice(issued);
  }

  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not ours */ }

  if (!res.ok) {
    const reason = parsed?.error ?? `the server said ${res.status}`;
    const error = new Error(reason);
    error.status = res.status;
    error.detail = parsed;
    throw error;
  }
  return parsed;
}

// --- what a slot looks like to something that cannot see the page -----------

/**
 * A slot, trimmed to what a caller needs to act on it.
 *
 * The whole slot carries a filter, a label, options and provenance; most of
 * that is for drawing a control. What is kept is the id to name it by, whether
 * it is answered, and -- for the slots whose choices are a short closed list --
 * that list, so a caller never has to search for "one of six attributes".
 */
const brief = (slot) => ({
  id: slot.id,
  label: slot.label,
  level: slot.level,
  kind: slot.kind,
  answered: !slot.empty,
  filled: slot.filledName ?? slot.filled ?? null,
  ...(slot.blockedBy ? { blockedBy: slot.blockedBy } : {}),
  ...(slot.count ? { takes: slot.count } : {}),
  ...(slot.options ? { choices: slot.options } : {}),
});

const text = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

const TOOLS = [
  {
    name: 'whoami',
    description: 'Which character this link opens, their level, and how many choices are outstanding.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const state = await call('/builder');
      return text({
        character: state.sheet.name || '(unnamed)',
        level: state.level,
        planningTo: state.planTo,
        ancestry: state.sheet.ancestry || null,
        heritage: state.sheet.heritage || null,
        background: state.sheet.background || null,
        class: state.sheet.class || null,
        outstanding: state.outstanding,
      });
    },
  },
  {
    name: 'get_build',
    description:
      'Every choice this character has, answered or not, with the slot id to name each by. '
      + 'Start here: the slot ids are what list_choices and choose take.',
    inputSchema: {
      type: 'object',
      properties: {
        unansweredOnly: { type: 'boolean', description: 'Only the slots still to fill.' },
      },
    },
    run: async ({ unansweredOnly = false }) => {
      const state = await call('/builder');
      const slots = state.slots.filter((s) => (unansweredOnly ? s.empty : true));
      return text({
        level: state.level,
        outstanding: state.outstanding,
        slots: slots.map(brief),
        problems: state.problems ?? [],
        missing: state.missing ?? [],
      });
    },
  },
  {
    name: 'get_character',
    description: 'The derived sheet: attributes, saves, skills, hit points, strikes, gear.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => text((await call('/builder')).sheet),
  },
  {
    name: 'list_choices',
    description:
      'What may legally go in one slot. Narrowed by the slot itself, so a level 6 class feat '
      + 'returns the few dozen this character can take rather than six thousand.',
    inputSchema: {
      type: 'object',
      properties: {
        slotId: { type: 'string', description: 'From get_build.' },
        search: { type: 'string', description: 'Narrow by name.' },
        limit: { type: 'number', description: 'Default 40.' },
      },
      required: ['slotId'],
    },
    run: async ({ slotId, search = '', limit = 40 }) => {
      const state = await call('/builder');
      const slot = state.slots.find((s) => s.id === slotId);
      if (!slot) {
        return text({
          error: `No slot called "${slotId}".`,
          slots: state.slots.map((s) => s.id),
        });
      }
      if (!slot.filter) {
        return text({
          slot: brief(slot),
          note: 'This slot is not chosen from the catalogue; its choices are listed above.',
        });
      }

      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(slot.filter)) {
        if (value === null || value === undefined || value === '') continue;
        query.set(key, String(value));
      }
      if (search) query.set('q', search);
      query.set('limit', String(Math.min(Number(limit) || 40, 100)));
      query.set('sort', 'rarity');

      const found = await call(`/builder/options?${query}`);
      return text({
        slot: brief(slot),
        showing: `${found.rows.length} of ${found.total}`,
        options: found.rows.map((row) => ({
          id: row.id,
          name: row.name,
          level: row.level,
          rarity: row.rarity,
          ...(row.homebrew ? { fromThisTable: true } : {}),
        })),
      });
    },
  },
  {
    name: 'read_option',
    description: 'One option in full, with its rules text, prerequisites and source.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'An option id from list_choices.' } },
      required: ['id'],
    },
    run: async ({ id }) => {
      const { option } = await call(`/builder/options/${encodeURIComponent(id)}`);
      return text({
        id: option.id,
        name: option.name,
        level: option.level,
        rarity: option.rarity,
        traits: option.traits ?? [],
        prerequisites: option.prerequisites ?? [],
        text: option.description?.text ?? '',
        source: option.source?.book ?? null,
      });
    },
  },
  {
    name: 'choose',
    description:
      'Fill one slot. Checked against what the slot allows and refused with a reason if it is '
      + 'not — read the reason and try again rather than assuming it worked.',
    inputSchema: {
      type: 'object',
      properties: {
        slotId: { type: 'string' },
        value: {
          description:
            'An option id for a slot chosen from the catalogue; an attribute or a list of them '
            + 'for boosts; a skill for a skill increase; null to clear the slot.',
        },
      },
      required: ['slotId'],
    },
    run: async ({ slotId, value = null }) => {
      const result = await call('/builder/choose', { method: 'POST', body: { slotId, value } });
      const slot = result.builder.slots.find((s) => s.id === slotId);
      return text({
        chose: result.chose,
        nowReads: slot ? brief(slot) : null,
        outstanding: result.builder.outstanding,
        problems: result.builder.problems ?? [],
      });
    },
  },
  {
    name: 'set_level',
    description:
      'Set the character’s level, or how far ahead to plan. Raising the level adds the slots '
      + 'that level brings.',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'number', description: '1 to 20.' },
        planTo: { type: 'number', description: 'Show slots up to this level without reaching it.' },
      },
    },
    run: async ({ level = null, planTo = null }) => {
      const state = await call('/builder');
      const build = { ...state.build };
      if (level !== null) build.level = Math.max(1, Math.min(20, Math.trunc(level)));
      if (planTo !== null) build.planTo = Math.max(build.level ?? 1, Math.min(20, Math.trunc(planTo)));
      const saved = await call('/builder', { method: 'PATCH', body: { build } });
      return text({
        level: saved.builder.level,
        planningTo: saved.builder.planTo,
        outstanding: saved.builder.outstanding,
      });
    },
  },
];

const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

// --- the protocol -----------------------------------------------------------

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(message) {
  const { id, method, params = {} } = message;
  // A notification has no id and takes no answer.
  if (id === undefined || id === null) return;

  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: params.protocolVersion === PROTOCOL ? PROTOCOL : PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: NAME, version: VERSION },
    });
  }

  if (method === 'ping') return reply(id, {});

  if (method === 'tools/list') {
    return reply(id, {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });
  }

  if (method === 'tools/call') {
    const tool = byName.get(params.name);
    if (!tool) return fail(id, -32602, `No tool called "${params.name}".`);
    try {
      return reply(id, await tool.run(params.arguments ?? {}));
    } catch (error) {
      /**
       * A refusal is a result, not a protocol error.
       *
       * `isError` is how MCP says "this failed and here is why" in a way the
       * model reads rather than the client swallowing it -- and the reason is
       * the entire value of the checked endpoint. Told as an error, the model
       * tries something else; told as a crash, the conversation stops.
       */
      return reply(id, {
        ...text(error.detail?.error ? error.detail : { error: error.message }),
        isError: true,
      });
    }
  }

  return fail(id, -32601, `Unknown method "${method}".`);
}

if (!base || !token) {
  process.stderr.write(
    'off-guard: set OFF_GUARD_URL and OFF_GUARD_TOKEN.\n'
    + '  OFF_GUARD_URL    https://offguard.example.com\n'
    + '  OFF_GUARD_TOKEN  the token from a character link\n',
  );
  process.exit(1);
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  handle(message).catch((error) => {
    process.stderr.write(`off-guard: ${error.stack ?? error.message}\n`);
    if (message?.id !== undefined && message.id !== null) {
      fail(message.id, -32603, error.message);
    }
  });
  return undefined;
});
