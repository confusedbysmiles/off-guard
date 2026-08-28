/**
 * Fetches the pinned foundryvtt/pf2e checkout into .cache/.
 *
 * Shells out to git rather than downloading a tarball: Node 20 has no tar, and a
 * blobless sparse clone pulls only the two paths we need (~380 MB instead of the
 * whole repo history). No npm dependency either way.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '../..');
export const LOCK = JSON.parse(
  readFileSync(resolve(HERE, 'upstream.lock.json'), 'utf8')
);
export const UPSTREAM_DIR = resolve(PROJECT_ROOT, '.cache/pf2e-upstream');

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

/** Clone if missing, then hard-pin to the locked commit. Returns the upstream path. */
export function ensureUpstream({ quiet = false } = {}) {
  const log = (m) => { if (!quiet) console.log(m); };

  if (!existsSync(resolve(UPSTREAM_DIR, '.git'))) {
    log(`Cloning ${LOCK.repo} (blobless, sparse)...`);
    mkdirSync(dirname(UPSTREAM_DIR), { recursive: true });
    git(['clone', '--filter=blob:none', '--no-checkout', LOCK.repo, UPSTREAM_DIR]);
    git(['sparse-checkout', 'set', '--no-cone', ...LOCK.sparsePaths], UPSTREAM_DIR);
  }

  const head = (() => {
    try { return git(['rev-parse', 'HEAD'], UPSTREAM_DIR); } catch { return null; }
  })();

  if (head !== LOCK.commit) {
    log(`Checking out pinned commit ${LOCK.commit.slice(0, 10)}...`);
    // The blobless clone may not have the pinned commit if the lock moved forward.
    try {
      git(['cat-file', '-e', `${LOCK.commit}^{commit}`], UPSTREAM_DIR);
    } catch {
      git(['fetch', '--filter=blob:none', 'origin', LOCK.branch], UPSTREAM_DIR);
    }
    git(['checkout', '--detach', LOCK.commit], UPSTREAM_DIR);
  }

  const actual = git(['rev-parse', 'HEAD'], UPSTREAM_DIR);
  if (actual !== LOCK.commit) {
    throw new Error(`Upstream is at ${actual}, expected ${LOCK.commit}. Refusing to build.`);
  }
  log(`Upstream pinned at ${actual}`);
  return UPSTREAM_DIR;
}

if (import.meta.url === `file://${process.argv[1]}`) ensureUpstream();
