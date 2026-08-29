# Moving Off-Guard to another machine

The thing worth knowing before anything else:

> **Every link keeps working.** Access tokens live in the database, not in a
> config file and not in the hostname. Move the database, keep the hostname
> pointed at whatever is running, and your players' bookmarks are still their
> bookmarks. Nobody has to be sent a new link, and there is no window where
> the GM link is the only one that works.

That is what makes this a twenty-minute job rather than an evening of messaging
five people. It also means the database is the only thing that is irreplaceable:
the checkout comes from git, the creature catalogue is rebuilt in six seconds,
and the tunnel can be recreated. Everything else on this page is bookkeeping
around moving one file safely.

## What actually has to move

| | How it gets there | Notes |
|---|---|---|
| The database | `npm run backup`, then `scp` | The only irreplaceable thing. One file. |
| The application | `git clone` | Nothing in the repo is machine-specific. |
| `node_modules` | `npm ci` on the new box | **Do not copy it.** `better-sqlite3` is a native module compiled for one architecture — a Mac's build will not load on a Raspberry Pi. |
| The creature catalogue | `npm run build:data` | 67 MB of build output. Rebuilding is faster than copying. |
| The tunnel | move the credentials file, or make a new tunnel | See below. |
| `.env` | written by the installer | Do not copy the old one; its `OFF_GUARD_DB` is a macOS path. |

## Before you start

On the new machine:

```bash
git clone https://github.com/confusedbysmiles/off-guard.git
cd off-guard
npm ci                 # compiles better-sqlite3 for this architecture
npm test               # nothing here needs a data build
npm run build:data     # ~7 minutes cold, and it needs the network once
```

If `npm ci` fails on `better-sqlite3`, that machine is missing a C++ toolchain:
`sudo apt install build-essential python3` on Debian and Ubuntu. It is needed
once, at install, and never at runtime.

Get that far *before* you stop the old server. Everything above is safe to do
while the table is still being served from the old machine, and it is where the
surprises are.

## The move

**1. Stop the old server.** Not just the tunnel — the server, so nothing can
write to the database after the copy is taken.

```bash
# on the old machine
./deploy/macos/install.sh --uninstall     # or: systemctl stop off-guard
```

**2. Take the final backup.**

```bash
npm run backup ~/off-guard-final.sqlite
```

It prints what it copied — campaigns, characters, encounters, tokens. Read
those numbers. They are the last chance to notice you backed up the wrong file,
and `1 campaign, 0 characters` is a sentence that should stop you.

Use the tool rather than `cp`. The database runs in WAL mode, so recent writes
live in `off-guard.sqlite-wal` until a checkpoint and a plain copy silently
loses them — a copy taken that way during the token migration came back with
one token in it instead of three, and nothing about it looked wrong. The backup
is written with DELETE journalling, so the file it produces *is* safe to move
with `cp` and `scp`.

**3. Carry it over, and put it where the service will look.**

```bash
scp ~/off-guard-final.sqlite newbox:/tmp/
# on the new machine
sudo install -o off-guard -g off-guard -m 0600 \
  /tmp/off-guard-final.sqlite /var/lib/off-guard/off-guard.sqlite
```

`install` rather than `cp` because ownership matters: the service runs as
`off-guard` and the unit gives it exactly one writable directory. A database
owned by root there produces a service that starts, fails to write, and looks
like a permissions bug at the first hit point change rather than at boot.

**4. Install the service.**

```bash
sudo ./deploy/linux/install.sh
```

It fills the real paths into the unit, refuses if the result points at a node
or a checkout that is not there, writes `.env` so a command typed into a shell
opens the same database the service does, and waits for `/healthz`.

**Do not mint a GM token.** You restored one. `node tools/mint-gm-token.js`
will tell you a GM token already exists, which is the correct answer and the
proof the restore worked.

**5. Move the tunnel.**

> **Stop the old `cloudflared` first.** A tunnel can have several connectors —
> that is how Cloudflare does high availability — so leaving one running on the
> old machine does not fail over, it load-balances. Half your players' requests
> would reach the old database and half the new one, writes would land on
> whichever answered, and it would look like the application randomly forgetting
> things.

The cheap way is to reuse the tunnel by carrying its credentials:

```bash
# old machine
sudo cloudflared service uninstall
scp ~/.cloudflared/<uuid>.json ~/.cloudflared/cert.pem newbox:~/.cloudflared/
# new machine
./deploy/cloudflared/setup.sh offguard.example.com
cloudflared tunnel run off-guard        # watch it in the foreground first
sudo cloudflared service install
```

The clean way is to make a new tunnel on the new machine — `cloudflared tunnel
login`, then the same `setup.sh` — and repoint the DNS record. That takes a
minute or two to propagate and needs no secrets moved between machines. Prefer
it if the old machine is one you are giving away.

Either way the hostname does not change, so the links do not change.

**6. Verify, in this order.**

```bash
curl -s http://127.0.0.1:8787/healthz            # the server
curl -s https://offguard.example.com/healthz      # through the tunnel
npm run backup --verify-only /var/lib/off-guard/off-guard.sqlite
```

Then open one player's existing link — an old one, from a bookmark, not one you
just made. That is the test that the whole point of this held.

## Afterwards

Keep the old machine's database until you have played a session on the new one.
Not as a plan, as a file: a backup that has never been restored is a hypothesis.

The old machine is now carrying a full copy of every campaign, every character
sheet and every token hash. Tokens are hashed, so it is not a set of working
links, but it is still the table's data. Delete it when you are confident, or
keep it somewhere you would keep a password manager export.

## If it goes wrong

Nothing here is one-way until you delete the old database.

```bash
# on the old machine
./deploy/macos/install.sh
cloudflared tunnel run off-guard
```

Stop the new server and its `cloudflared` first, for the same load-balancing
reason as above. The links keep working there too — they never stopped being
valid, they were only pointed somewhere else.
