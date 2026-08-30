/**
 * Start here, for the GM.
 *
 * Written for whoever is running the game, not for whoever maintains this:
 * plain language, no mention of SQLite or Server-Sent Events. What it says
 * depends on where this table actually is — a dashboard with no campaign in it
 * gets first steps, one with three campaigns and a fight running does not.
 *
 * Kept deliberately in step with what the application does today. Anything the
 * brief asked for that is not built, or is built and approximate, is under
 * "Rough edges" rather than described as though it were finished.
 */
import { el } from '../../lib/dom.js';
import { b, guide, h3, kbd, p, shortcutTable, ul } from '../../lib/guide.js';
import { SHORTCUT_GROUPS, SHORTCUTS, TABS } from '../shortcuts.js';

const tabName = (id) => TABS.find(([tab]) => tab === id)?.[1] ?? id;
const tabKey = (id) => TABS.find(([tab]) => tab === id)?.[2] ?? '';

/** "the Initiative tab (I)" */
const tab = (id) => el('span', {}, b(tabName(id)), ' tab (', kbd(tabKey(id)), ')');

export function startPanel(state, { onTab }) {
  const campaigns = state.campaigns ?? [];
  const characters = state.party?.characters ?? [];
  const playerLinks = (state.tokens ?? []).filter((t) => t.kind === 'character');
  const noCatalogue = state.catalogue?.available === false;
  const campaign = campaigns.find((c) => c.id === state.campaignId) ?? null;

  const sections = [];

  // --- where this table actually is ---------------------------------------

  if (!campaigns.length) {
    sections.push({
      id: 'first',
      title: 'Your first five minutes',
      body: [
        p('There are no campaigns yet, so nothing else on this dashboard has '
          + 'anything to show. In order:'),
        ul(
          ['Open ', tab('overview'), ' and make a campaign. Give it a name you '
            + 'would say out loud — "Tuesday: Abomination Vaults" — and an accent '
            + 'colour. The colour is what stops you applying damage to the wrong '
            + 'table’s goblin at eleven at night.'],
          ['Set the party level on ', tab('setup'), '.'],
          ['Add your players on ', tab('setup'), ', one row each, then make each '
            + 'of them a link.'],
          ['Build a fight on ', tab('encounters'), ', and start it from ',
            tab('initiative'), '.'],
        ),
        p('Nothing here needs setting up beyond that. There is no configuration '
          + 'file to edit and no account to create.'),
      ],
    });
  } else if (!characters.length) {
    sections.push({
      id: 'first',
      title: 'Next: add your players',
      body: [
        p(campaign ? el('span', {}, b(campaign.name), ' has no characters in it yet. ')
          : 'This campaign has no characters in it yet. ',
        'Add a row for each player on ', tab('setup'), ' — a name and a level is '
          + 'enough to start. Everything else they can fill in themselves.'),
      ],
    });
  } else if (!playerLinks.length) {
    sections.push({
      id: 'first',
      title: `Next: get ${characters.length === 1 ? 'your player' : 'your players'} in`,
      body: [
        p('There ',
          characters.length === 1 ? 'is one character ' : `are ${characters.length} characters `,
          'here and no player links yet, so nobody but you can see any of it. '
          + 'Make a link for each of them on ', tab('setup'), '.'),
        p('A link is shown ', b('once'), ' and cannot be shown again. Send it '
          + 'straight to the person it belongs to. If one goes missing, rotate '
          + 'it — that makes a new link and kills the old one in the same move.'),
        p('You do not need to know what anyone is playing yet. A player’s name '
          + 'on its own makes a row and a link; the character names itself when '
          + 'they import or type it, and the link stays theirs either way.'),
      ],
    });
  }

  // --- the tabs -----------------------------------------------------------

  sections.push({
    id: 'tabs',
    title: 'What the tabs are for',
    body: [
      p('Each has a key, shown on the tab itself. Pressing it works from '
        + 'anywhere, including mid-fight.'),
      el('dl', { class: 'keys' },
        ...TABS.filter(([id]) => id !== 'start').flatMap(([id, label, key]) => [
          el('dt', { class: 'keys__key' }, kbd(key)),
          el('dd', { class: 'keys__what' },
            el('span', {}, el('button', {
              class: 'link-button', type: 'button', onclick: () => onTab(id),
            }, label)),
            el('span', { class: 'faint keys__hint' }, ({
              table: 'The party at a glance, live from the sheets your players '
                + 'are typing into. Read-only; this is the tab to leave open.',
              initiative: 'The fight. Initiative order, hit points, conditions, '
                + 'and whose turn it is — which is also what the shared screen shows.',
              encounters: 'Build a fight before the session, or during one. '
                + 'Search the creature catalogue, and watch the XP budget as you add.',
              setup: 'Everything about this campaign that is not a fight: its '
                + 'name and colour, who is in it, their links, and what happened last week.',
              overview: 'Every campaign you run, with when you last played each.',
            })[id]),
        )])),
    ],
  });

  // --- the three screens --------------------------------------------------

  sections.push({
    id: 'screens',
    title: 'The three screens',
    body: [
      p('This is one application wearing three faces, and which one somebody '
        + 'gets is decided entirely by the link they were sent.'),
      ul(
        [b('This dashboard'), ' is yours. One link, and it can do everything.'],
        [b('A character sheet'), ' is one player’s. It saves as they type, works '
          + 'with no signal, and shows only their own character.'],
        [b('The shared screen'), ' is for the television. It is read-only — there '
          + 'is no control on it that can change anything — and it shows initiative '
          + 'order and whose turn it is, updating by itself as you run the fight.'],
      ),
      p('The shared screen names players but describes creatures: your goblin '
        + 'shows as ', b('Unharmed'), ' or ', b('Bloodied'), ', never as 6/6. '
        + 'A combatant you have hidden does not appear at all, and leaves no gap '
        + 'where it was.'),
      p('All three update themselves. Nobody needs to refresh anything.'),
    ],
  });

  // --- links --------------------------------------------------------------

  sections.push({
    id: 'links',
    title: 'Links, and how access works',
    body: [
      p('There are no accounts and no passwords. ', b('The link is the '
        + 'credential.'), ' Anyone holding a link has exactly what that link is '
        + 'for, and nothing else.'),
      ul(
        'A player’s link opens their sheet and no one else’s.',
        'The shared screen’s link is read-only and cannot be typed into.',
        'A link belongs to one campaign, so a player in two of your games has two links.',
      ),
      p('Links are stored hashed, which is why a new one is shown ', b('once'),
        ' and never again — the server cannot show it to you a second time '
        + 'because it does not keep it. ', 'Rotating is the answer to a lost or '
        + 'shared link: it issues a new one and kills the old one together.'),
      playerLinks.length
        ? p('You have handed out ', b(String(playerLinks.length)),
          playerLinks.length === 1 ? ' player link. ' : ' player links. ',
          'They are listed on ', tab('setup'), ' by who they belong to — the '
          + 'listing says what exists, not what it is.')
        : null,
      p('Treat one like a house key rather than a password: it is not a secret '
        + 'anybody has to remember, and it is also the whole of the lock.'),
    ].filter(Boolean),
  });

  // --- running a session --------------------------------------------------

  sections.push({
    id: 'session',
    title: 'Running a session',
    body: [
      h3('Before'),
      p('Build the fights on ', tab('encounters'), '. The XP budget updates as '
        + 'you add creatures and tells you what the party will find it — trivial '
        + 'through extreme. A fight whose creatures are too far from the party’s '
        + 'level is refused a difficulty rather than given a made-up one.'),
      h3('During'),
      p('Start the fight from ', tab('initiative'), ', then ', kbd('Space'),
        ' between turns. Damage and healing go in the box on each row; '
        + 'conditions come from the menu beside it and appear on the player’s '
        + 'own sheet within a second.'),
      p('Only ', b('frightened'), ' counts itself down at the end of a turn, '
        + 'because that is the only one the rules say does so unprompted. '
        + 'Everything else — dying, stunned, drained — asks you, and quotes the '
        + 'sentence it is asking about.'),
      h3('After'),
      p('Write the session up on ', tab('setup'), '. It timestamps the campaign '
        + 'as played, which is what orders ', tab('overview'), ' so the game you '
        + 'run on Tuesdays is the one you land on.'),
    ],
  });

  // --- the catalogue, if there is one -------------------------------------

  sections.push({
    id: 'catalogue',
    title: 'The creature catalogue',
    body: noCatalogue
      ? [
        p('There is no catalogue on this server, so creature search is empty '
          + 'and the encounter builder has nothing to offer you. It is a build '
          + 'step rather than a download:'),
        el('pre', { class: 'code' }, el('code', {}, 'npm run build:data')),
        p('Everything else works without it. You can still run a fight by adding '
          + 'combatants by hand.'),
      ]
      : [
        p('Around 6,400 creatures and 1,200 hazards, searchable by name, level, '
          + 'trait and source. Add one to a fight and it arrives with its full '
          + 'stat block, its abilities and its rules text.'),
        p(b('Elite'), ' and ', b('weak'), ' are the printed adjustments and are '
          + 'exact. ', b('Level scaling'), ' is not: see below.'),
        p('Every entry carries the book and, where it could be established, the '
          + 'page — so "it is on page 143" is a thing you can say at the table '
          + 'without going to look.'),
      ],
  });

  // --- keyboard -----------------------------------------------------------

  sections.push({
    id: 'keyboard',
    title: 'The keyboard',
    body: [
      p('This dashboard is built to be driven one-handed, because the other one '
        + 'is holding dice. Keys do nothing while you are typing in a box.'),
      shortcutTable(SHORTCUTS, SHORTCUT_GROUPS),
    ],
  });

  // --- honesty ------------------------------------------------------------

  sections.push({
    id: 'rough',
    title: 'Rough edges',
    body: [
      p('Mentioned so you find out here rather than at the table.'),
      ul(
        [b('Level scaling is an approximation.'), ' Elite and weak are printed '
          + 'rules and exact. Running a level 5 creature as a level 8 is not a '
          + 'printed operation at all — it is reconstructed from the '
          + 'creature-building tables, and every scaled stat block says so.'],
        [b('One spellcasting block per creature.'), ' A creature with both '
          + 'prepared and innate spells shows the first. The stat block is right; '
          + 'the sheet is where this is missing.'],
        [b('Importing a Pathbuilder character by its build ID often fails.'),
          ' Pathbuilder’s site answers servers with a challenge page. Exporting '
          + 'the JSON from Pathbuilder and uploading the file works, and is the '
          + 'path to use.'],
        [b('There is no undo on the dashboard.'), ' The player’s sheet has one; '
          + 'this does not. Removing a combatant removes it.'],
      ),
    ],
  });

  return guide({
    title: 'Start here',
    lead: [
      p('A table application for Pathfinder Second Edition: one dashboard for '
        + 'you, a sheet for each player, and a screen for the room.'),
      campaign
        ? p('You are looking at ', b(campaign.name), '. Press ', kbd('C'),
          ' to switch, or a number key to jump straight to one.')
        : null,
    ].filter(Boolean),
    sections,
  });
}
