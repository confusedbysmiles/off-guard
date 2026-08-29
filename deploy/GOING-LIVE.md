# Going live

The shape this is written for: Off-Guard runs on a machine you own, a Cloudflare
Tunnel connects it outbound to `offguard.drseim.com`, and nothing listens on a
public port anywhere.

**A subdomain, not `drseim.com/off-guard`.** A tunnel becomes the origin for a
whole hostname, so pointing `www.drseim.com` at it would take the rest of the
site — which is GitHub Pages — with it. Splitting one hostname across two
origins needs a Cloudflare Worker in front of both, and that is a third moving
part between the table and the application. The application supports either;
this is a deployment choice, and the subdomain is the cheap one.

---

## 1. On the machine that will run it

```bash
git clone https://github.com/confusedbysmiles/off-guard.git
cd off-guard
npm ci
npm test                      # 524 unit tests, no data build needed
```

**Build the creature catalogue before you need it**, not at the table. It clones
a pinned checkout of the Foundry pf2e system, which is about 380 MB, and takes
around seven minutes cold and six seconds after.

```bash
npm run build:data
```

Without it the application still starts and says the catalogue is missing. The
reference drawer, the dice, the sheets and initiative all work regardless — only
creature search and stat blocks need it.

## 2. Somewhere for the database to live

```bash
mkdir -p ~/Library/Application\ Support/off-guard
```

Everything is in that one file: every campaign, every sheet, every token hash.

## 3. Run it under launchd

```bash
cp deploy/macos/com.drseim.off-guard.plist ~/Library/LaunchAgents/
```

Edit the three `/Users/YOU/...` paths and check the `node` path matches
`which node`. Then:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.drseim.off-guard.plist
curl -s localhost:8787/healthz     # {"ok":true}
```

Stop it sleeping, or players cannot reach their sheets between sessions:

```bash
sudo pmset -a sleep 0 disksleep 0
```

## 4. The tunnel

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create off-guard
cloudflared tunnel route dns off-guard offguard.drseim.com
```

Copy `deploy/cloudflared/config.yml` to `~/.cloudflared/config.yml`, fill in the
credentials path the create step printed, then:

```bash
cloudflared tunnel run off-guard
```

Once it works, `sudo cloudflared service install` keeps it running.

## 5. Your link

```bash
node tools/mint-gm-token.js
```

**Printed once and never again** — tokens are stored hashed. Put it in a
password manager before you close the terminal. If you lose it, mint a new one
by rotating from a session you are still signed into; if you have lost every
copy, the row has to be deleted from the database by hand.

Then open `https://offguard.drseim.com/gm/<token>` and, on the **Setup** tab:
give the campaign a name and an accent colour, add each character, and make each
player's link. Each of those is shown once too.

---

## Before the first real session

- [ ] Open the shared-screen link on the actual television and check it says
      **Live**, then change something on the dashboard and watch it move. This
      is the one thing a tunnel could plausibly break, and finding out at the
      table is the wrong time.
- [ ] Open a player link on a phone, on mobile data rather than your wifi.
- [ ] Have one player export from Pathbuilder and import it, then read the
      warnings. Weapon damage is the field worth checking by eye: Pathbuilder
      does not export weapon traits, so whether Strength applies is a judgement
      the import cannot make.
- [ ] Set a different accent colour per campaign. It is the thing that stops you
      applying damage to the wrong table's goblin at eleven at night.

## Keeping it

**A WAL database is not one file.** Copying `off-guard.sqlite` on its own loses
whatever is still in `off-guard.sqlite-wal`, silently. Use SQLite's own backup,
which is consistent against a running server:

```bash
sqlite3 ~/Library/Application\ Support/off-guard/off-guard.sqlite \
  ".backup '$HOME/Backups/off-guard-$(date +%F).sqlite'"
```

Worth a `launchd` timer or a cron line. The file is small — a season of play is
a few megabytes — so keep them all.

## Updating

```bash
git pull && npm ci
launchctl kickstart -k gui/$(id -u)/com.drseim.off-guard
```

Migrations run at startup, each in its own transaction; a failed one stops the
server rather than leaving half a schema. Back up first anyway.

Bumping the bundled Paizo data is deliberate and separate: edit the commit in
`tools/build-data/upstream.lock.json`, then `npm run build:data` and
`npm run build:tables`. Nothing does that on its own.
