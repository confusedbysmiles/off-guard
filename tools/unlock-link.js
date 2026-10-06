#!/usr/bin/env node
/**
 * `npm run unlock -- [id|--all] [--forget]`
 *
 * The way back from a locked link, from a shell rather than from a link.
 *
 * Locking is per link and includes the GM's own, which is the one that can
 * strand you: granting a device is a dashboard action, and the dashboard is
 * behind the link you just locked against the device you are holding. Nobody
 * should discover that at eleven at night with five people waiting, so the
 * remedy exists before the mistake does.
 *
 * It says which database it opened, every time. "Unlocked" is a complete
 * sentence and a useless one when the database it is about is not the one the
 * running server has open -- which is what happens when a service takes its
 * path from a unit file and a shell takes the default.
 */
import { openDatabase } from '../src/server/db.js';
import { config } from '../src/server/index.js';

const args = process.argv.slice(2);
const all = args.includes('--all');
const forget = args.includes('--forget');
const named = args.find((a) => !a.startsWith('--'));

const settings = config();
const db = openDatabase(settings.database, { migrationsDir: settings.migrations });

process.stdout.write(`\nDatabase: ${settings.database}\n\n`);

const links = db.prepare(`
  SELECT t.id, t.kind, t.campaign_id AS campaignId, t.locked_at AS lockedAt,
         c.name AS characterName,
         (SELECT COUNT(*) FROM token_device d WHERE d.token_id = t.id) AS devices
  FROM token t
  LEFT JOIN character c ON c.id = t.character_id
  WHERE t.revoked_at IS NULL
  ORDER BY t.kind, t.id
`).all();

/** What a link is, for somebody reading a terminal and not a dashboard. */
const describe = (link) => [
  `#${link.id}`.padEnd(5),
  link.kind.padEnd(10),
  (link.characterName ?? (link.campaignId ? `campaign ${link.campaignId}` : 'every campaign')).padEnd(24),
  link.lockedAt ? 'LOCKED' : 'open  ',
  `${link.devices} device${link.devices === 1 ? '' : 's'}`,
].join(' ');

if (!all && !named) {
  if (!links.length) process.stdout.write('No links.\n');
  for (const link of links) process.stdout.write(`  ${describe(link)}\n`);
  process.stdout.write(
    '\nUnlock one:   npm run unlock -- <id>'
    + '\nUnlock all:   npm run unlock -- --all'
    + '\nAlso forget its devices, so the next one to open it is trusted again:'
    + '\n              npm run unlock -- <id> --forget\n\n',
  );
  db.close();
  process.exit(0);
}

const targets = all ? links : links.filter((link) => String(link.id) === String(named));

if (!targets.length) {
  process.stderr.write(`No link with id ${named}. Run with no arguments to list them.\n\n`);
  db.close();
  process.exit(1);
}

const unlock = db.prepare('UPDATE token SET locked_at = NULL WHERE id = ?');
const clear = db.prepare('DELETE FROM token_device WHERE token_id = ?');

for (const link of targets) {
  unlock.run(link.id);
  const forgotten = forget ? clear.run(link.id).changes : 0;
  // The counts are read back rather than carried from the listing, so the line
  // describes the link as it is now and not as it was a statement ago.
  process.stdout.write(
    `  Unlocked ${describe({ ...link, lockedAt: null, devices: link.devices - forgotten })}`
    + (forget ? ` (forgot ${forgotten})` : '')
    + '\n',
  );
}

process.stdout.write('\nThose links now accept any device again, and record it.\n\n');
db.close();
