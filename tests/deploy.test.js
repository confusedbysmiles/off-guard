/**
 * The deployment manifests, against the repository they describe.
 *
 * Two of these files have never been run: no Docker on this machine, and no
 * systemd either. The honest thing to do about that is not to claim they work,
 * but to make every claim they make checkable — a `COPY` of a directory that
 * has been renamed, a port that agrees with three files and not the fourth, an
 * `OFF_GUARD_` name with a typo in it. None of that needs a container to catch.
 *
 * The plist test is the one with a scar behind it. The template ships with
 * `/Users/YOU` placeholders; a copy that skipped the installer loaded an agent
 * that could not start, and launchd reported `EX_CONFIG` into a log file it
 * also could not open, so there was nothing on screen and nothing on disk.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

const MANIFESTS = [
  'Dockerfile',
  'docker-compose.yml',
  'deploy/off-guard.service',
  'deploy/nginx.conf',
  'deploy/macos/com.drseim.off-guard.plist',
  'deploy/macos/install.sh',
  'deploy/cloudflared/setup.sh',
];

const PORT = 8787;

describe('every OFF_GUARD_ name a manifest sets', () => {
  const readAll = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (
    entry.isDirectory() ? readAll(`${dir}/${entry.name}`) : [read(`${dir}/${entry.name}`)]
  ));

  it('is one the application actually reads', () => {
    const source = [...readAll('src'), ...readAll('tools')].join('\n');
    for (const file of MANIFESTS) {
      for (const name of new Set(read(file).match(/OFF_GUARD_[A-Z_]+/g) ?? [])) {
        expect(source.includes(name), `${file} sets ${name}, which nothing reads`).toBe(true);
      }
    }
  });

  it('is documented in .env.example', () => {
    const documented = read('.env.example');
    for (const file of MANIFESTS) {
      for (const name of new Set(read(file).match(/OFF_GUARD_[A-Z_]+/g) ?? [])) {
        expect(documented.includes(name), `${file} sets ${name}, undocumented`).toBe(true);
      }
    }
  });
});

describe('the Dockerfile', () => {
  const dockerfile = read('Dockerfile');

  it('copies only paths that exist', () => {
    // `COPY --from=build ...` names a path inside the earlier stage, not one
    // in this repository, so it is not a claim about the checkout.
    const copies = [...dockerfile.matchAll(/^COPY (?!--from)(.+)$/gm)]
      .flatMap(([, line]) => line.trim().split(/\s+/).slice(0, -1));
    expect(copies.length).toBeGreaterThan(4);
    for (const path of copies) {
      expect(existsSync(path), `Dockerfile copies ${path}, which is not here`).toBe(true);
    }
  });

  it('starts the same entry point the package does', () => {
    const start = JSON.parse(read('package.json')).scripts.start;
    expect(dockerfile).toContain(start.replace(/^node /, ''));
  });
});

describe('the port', () => {
  it('is the same number everywhere it appears', () => {
    // A container published on one port and answering on another is a
    // twenty-minute debugging session for a number that should be typed once.
    expect(read('src/server/index.js')).toContain(`?? ${PORT}`);
    expect(read('Dockerfile')).toContain(`OFF_GUARD_PORT=${PORT}`);
    expect(read('Dockerfile')).toContain(`EXPOSE ${PORT}`);
    expect(read('docker-compose.yml')).toContain(`127.0.0.1:${PORT}:${PORT}`);
    expect(read('deploy/off-guard.service')).toContain(`OFF_GUARD_PORT=${PORT}`);
    expect(read('deploy/nginx.conf')).toContain(`proxy_pass http://127.0.0.1:${PORT}`);
    expect(read('deploy/macos/com.drseim.off-guard.plist')).toContain(`<string>${PORT}</string>`);
  });
});

describe('the launchd template and its installer', () => {
  const plist = read('deploy/macos/com.drseim.off-guard.plist');
  const install = read('deploy/macos/install.sh');

  it('agrees on the label', () => {
    const label = /<key>Label<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)[1];
    expect(install).toContain(`LABEL="${label}"`);
  });

  it('leaves no placeholder the installer does not substitute', () => {
    // Every `/Users/YOU` path in the template has to appear in a `sed` in the
    // installer, or it survives into ~/Library/LaunchAgents and the agent
    // fails to start with nothing to read about why.
    const placeholders = new Set(
      (plist.match(/\/Users\/YOU[^<"\s]*(?: [^<"\s]+)*/g) ?? [])
        .map((path) => path.replace(/\/[^/]*\.(sqlite|log)$/, '')),
    );
    expect(placeholders.size).toBeGreaterThan(2);
    for (const path of placeholders) {
      expect(install.includes(path), `nothing substitutes ${path}`).toBe(true);
    }
  });

  it('refuses to install a plist with a placeholder left in it', () => {
    expect(install).toContain('/Users/YOU');
    expect(install).toContain('refusing to install a broken agent');
  });
});

describe('the shell scripts', () => {
  it.each(MANIFESTS.filter((f) => f.endsWith('.sh')))('%s is executable', (file) => {
    expect(statSync(file).mode & 0o111).toBeGreaterThan(0);
  });

  it.each(MANIFESTS.filter((f) => f.endsWith('.sh')))('%s stops on an error', (file) => {
    // Every one of these does something irreversible partway through.
    expect(read(file)).toContain('set -euo pipefail');
  });
});
