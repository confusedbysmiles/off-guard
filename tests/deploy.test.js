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
  'deploy/off-guard.service',
  'deploy/nginx.conf',
  'deploy/macos/com.drseim.off-guard.plist',
  'deploy/macos/com.drseim.off-guard-backup.plist',
  'deploy/macos/install.sh',
  'deploy/linux/install.sh',
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

describe('every manifest that starts the server', () => {
  it('starts the same entry point the package does', () => {
    const entry = JSON.parse(read('package.json')).scripts.start.replace(/^node /, '');
    expect(existsSync(entry)).toBe(true);
    for (const file of ['deploy/off-guard.service', 'deploy/macos/com.drseim.off-guard.plist']) {
      expect(read(file), `${file} does not start ${entry}`).toContain(entry);
    }
  });
});

describe('the port', () => {
  it('is the same number everywhere it appears', () => {
    // A container published on one port and answering on another is a
    // twenty-minute debugging session for a number that should be typed once.
    expect(read('src/server/index.js')).toContain(`?? ${PORT}`);
    expect(read('deploy/off-guard.service')).toContain(`OFF_GUARD_PORT=${PORT}`);
    expect(read('deploy/nginx.conf')).toContain(`proxy_pass http://127.0.0.1:${PORT}`);
    expect(read('deploy/macos/com.drseim.off-guard.plist')).toContain(`<string>${PORT}</string>`);
  });
});

describe('the launchd templates and their installer', () => {
  const install = read('deploy/macos/install.sh');
  const PLISTS = [
    ['deploy/macos/com.drseim.off-guard.plist', 'LABEL'],
    ['deploy/macos/com.drseim.off-guard-backup.plist', 'BACKUP_LABEL'],
  ];

  it.each(PLISTS)('%s: the installer knows its label', (file, variable) => {
    const label = /<key>Label<\/key>\s*<string>([^<]+)<\/string>/.exec(read(file))[1];
    expect(install).toContain(`${variable}="${label}"`);
    // The template is found by its label, so the filename has to match it.
    expect(file).toContain(`${label}.plist`);
  });

  it.each(PLISTS)('%s: leaves no placeholder the installer does not substitute', (file) => {
    // Every `/Users/YOU` path in a template has to appear in a `sed` in the
    // installer, or it survives into ~/Library/LaunchAgents and the agent
    // fails to start with nothing to read about why.
    const placeholders = new Set(
      (read(file).match(/\/Users\/YOU[^<"\s]*(?: [^<"\s]+)*/g) ?? [])
        .map((path) => path.replace(/\/[^/]*\.(sqlite|log)$/, '')),
    );
    expect(placeholders.size).toBeGreaterThan(0);
    for (const path of placeholders) {
      expect(install.includes(path), `nothing substitutes ${path}`).toBe(true);
    }
  });

  it.each(PLISTS)('%s: runs a program that is in the repository', (file) => {
    const script = /<string>(tools\/[^<]+|src\/[^<]+)<\/string>/.exec(read(file));
    expect(script, `${file} names no script`).not.toBeNull();
    expect(existsSync(script[1]), `${file} runs ${script[1]}, which is not here`).toBe(true);
  });

  it('refuses to install a plist with a placeholder left in it', () => {
    expect(install).toContain('/Users/YOU');
    expect(install).toContain('refusing to install a broken agent');
  });

  it('removes both agents when it uninstalls, and neither database', () => {
    const uninstall = install.slice(install.indexOf('--uninstall'), install.indexOf('# --- what'));
    expect(uninstall).toContain('$BACKUP_TARGET');
    expect(uninstall).toContain('$TARGET');
    expect(uninstall).toMatch(/untouched/);
    expect(uninstall).not.toMatch(/rm -rf/);
  });

  it('proves the weekly backup works instead of scheduling it and hoping', () => {
    expect(install).toContain('kickstart -w "$DOMAIN/$BACKUP_LABEL"');
  });
});

describe('the systemd unit and its installer', () => {
  const unit = read('deploy/off-guard.service');
  const install = read('deploy/linux/install.sh');

  it('rewrites every line that names a path on this machine', () => {
    // The macOS template uses `/Users/YOU` placeholders; this one ships real
    // defaults, so what has to hold is that the installer overwrites each of
    // them rather than leaving one at somebody else's path.
    for (const key of ['WorkingDirectory', 'ExecStart', 'Environment=OFF_GUARD_DB']) {
      expect(unit, `the unit has no ${key}`).toContain(`${key}=`);
      expect(install, `install.sh does not rewrite ${key}`).toContain(`s|^${key}=.*|`);
    }
  });

  it('checks the result rather than trusting the substitution', () => {
    expect(install).toContain('would point at something that is not there');
  });

  it('leaves the database alone when it uninstalls', () => {
    expect(install).toContain('--uninstall');
    expect(install).toMatch(/database at \$\{DB_DIR\} and the .* are untouched/);
    expect(install).not.toMatch(/rm -rf .*DB_DIR/);
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
