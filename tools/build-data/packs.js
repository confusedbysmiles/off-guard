/** Walking the upstream pack tree. Packs nest (feats/ancestry/android/level-5/…). */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export const packsRoot = (upstream) => resolve(upstream, 'packs/pf2e');

/** Every pack directory name, sorted. */
export function listPacks(upstream) {
  return readdirSync(packsRoot(upstream), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Yield `{ pack, file, doc }` for every JSON document in a pack, recursively. */
export function* readPack(upstream, pack) {
  const root = join(packsRoot(upstream), pack);
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { stack.push(full); continue; }
      if (!entry.name.endsWith('.json')) continue;
      let doc;
      try {
        doc = JSON.parse(readFileSync(full, 'utf8'));
      } catch {
        continue; // A handful of pack files are folder manifests, not documents.
      }
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) continue;
      yield { pack, file: full, doc };
    }
  }
}

/**
 * Read a file that lives outside the sparse checkout. The blobless clone fetches
 * the blob on demand, so this stays pinned to the locked commit.
 */
export function readFromGit(upstream, path) {
  try {
    return execFileSync('git', ['show', `HEAD:${path}`], {
      cwd: upstream, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/** Same, parsed. Returns null when the path is absent upstream. */
export function readJsonFromGit(upstream, path) {
  const raw = readFromGit(upstream, path);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export { statSync };
