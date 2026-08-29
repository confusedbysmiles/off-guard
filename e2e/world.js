/**
 * Which server a spec talks to, and the world it was seeded with.
 *
 * Two servers, because two Playwright projects cannot share one. The Chromium
 * suite rotates links — that is one of the things it is there to prove — and a
 * rotated link is a dead link, so a second project reading the same
 * `world.json` would be handed tokens the first project had already revoked.
 * A server of its own, on its own database, is cheaper than making every test
 * defensive about state it did not set.
 */
import { readFileSync } from 'node:fs';

const BASE = Number(process.env.OFF_GUARD_E2E_PORT ?? 8799);

export const PORTS = { desktop: BASE, webkit: BASE + 1 };

export const worldFile = (port) => new URL(`./.world-${port}.json`, import.meta.url);

export const loadWorld = (port) => JSON.parse(readFileSync(worldFile(port), 'utf8'));
