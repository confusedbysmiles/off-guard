/**
 * Campaign settings, the roster, and the session log.
 *
 * Everything about a campaign that is not a fight. The API for all of this has
 * existed since milestone 3; until now the only way to set a campaign's accent
 * colour was curl, which is a poor answer for the one feature the whole
 * multi-campaign design rests on.
 *
 * The accent colour is not decoration. It runs through the top border, the
 * switcher swatch, every panel heading and the left edge of every party card,
 * and it is the thing that stops a GM applying damage to the wrong table's
 * goblin at eleven at night. So it gets a real picker and a set of defaults
 * that are actually distinguishable from each other.
 */
import { displayName, isUnnamed } from '../../../../engine/shared/character-name.js';
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';

/**
 * Six accents that stay distinct from one another.
 *
 * Chosen to be told apart by someone with the common forms of colour blindness
 * as well: no red/green pair, and each differs from its neighbours in lightness
 * as well as hue, so the swatch is legible even where the hue is not.
 */
export const ACCENTS = [
  ['#667EEA', 'Indigo'],
  ['#34D399', 'Green'],
  ['#F59E0B', 'Amber'],
  ['#EC4899', 'Pink'],
  ['#06B6D4', 'Cyan'],
  ['#A78BFA', 'Violet'],
];

const field = (label, control, hint = null) => el('div', { class: 'field' },
  el('label', { class: 'field__label', for: control.id }, label),
  control,
  hint ? el('span', { class: 'faint' }, hint) : null);

/**
 * A debounced text field that saves on its own.
 *
 * The same shape the character sheet uses, for the same reason: a GM typing a
 * chapter name should not have to find a save button, and an explicit one would
 * be the only save button in the application.
 */
function autoField(id, value, onSave, attrs = {}) {
  return el('input', {
    class: 'input', id, type: 'text', value: value ?? '', autocomplete: 'off',
    onchange: (event) => onSave(event.target.value),
    ...attrs,
  });
}

function accentPicker(current, onPick) {
  return el('div', { class: 'accents', role: 'group', 'aria-label': 'Accent colour' },
    ...ACCENTS.map(([value, name]) => el('button', {
      class: 'accent', type: 'button',
      'aria-pressed': String((current ?? '').toLowerCase() === value.toLowerCase()),
      dataset: { accent: value },
      title: name,
      html: `<span class="sr-only">${name}</span>`,
      onclick: () => onPick(value),
    })),
    el('input', {
      class: 'accent accent--custom', type: 'color', id: 'accent-custom',
      value: current ?? ACCENTS[0][0],
      'aria-label': 'A colour of your own',
      onchange: (event) => onPick(event.target.value),
    }));
}

export function campaignPanel({ campaign, actions }) {
  if (!campaign) return null;
  const save = (fields) => actions.saveCampaign(fields);

  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'This campaign'),
      campaign.archivedAt
        ? el('button', {
          class: 'btn', type: 'button',
          html: `${icon('undo')}<span>Unarchive</span>`,
          onclick: () => actions.archiveCampaign(false),
        })
        : el('button', {
          class: 'btn btn--quiet', type: 'button',
          html: `${icon('cloudOff')}<span>Archive</span>`,
          title: 'Hide it from the switcher. Nothing is deleted.',
          onclick: () => actions.archiveCampaign(true),
        })),

    campaign.archivedAt
      ? el('p', { class: 'notice-inline' }, 'This campaign is archived.')
      : null,

    el('div', { class: 'settings' },
      field('Name', autoField('campaign-name-field', campaign.name, (v) => save({ name: v }))),
      field('Adventure', autoField('campaign-adventure', campaign.adventure, (v) => save({ adventure: v })),
        'Abomination Vaults, or your own'),
      field('Chapter', autoField('campaign-chapter', campaign.chapter, (v) => save({ chapter: v })),
        'Where you are in it'),
      field('Party level',
        el('input', {
          class: 'input', id: 'campaign-level', type: 'number', min: '-1', max: '25',
          value: String(campaign.partyLevel ?? 1),
          onchange: (event) => save({ partyLevel: Number(event.target.value) }),
        }),
        'Only a fallback — the budget uses the sheets'),
      field('Next session',
        el('input', {
          class: 'input', id: 'campaign-next', type: 'date',
          value: (campaign.nextSessionAt ?? '').slice(0, 10),
          onchange: (event) => save({ nextSessionAt: event.target.value || null }),
        })),
      el('div', { class: 'field' },
        el('span', { class: 'field__label' }, 'Accent colour'),
        accentPicker(campaign.accentColor, (value) => save({ accentColor: value })),
        el('span', { class: 'faint' },
          'Runs through the whole dashboard. Give each table a colour you can '
          + 'tell apart at a glance.'))),

    el('div', { class: 'field stack-md' },
      el('label', { class: 'field__label', for: 'campaign-notes' }, 'Notes'),
      el('textarea', {
        class: 'input', id: 'campaign-notes', rows: '3',
        onchange: (event) => save({ notes: event.target.value }),
      }, campaign.notes ?? '')));
}

export function rosterPanel({ characters, actions }) {
  const name = el('input', {
    class: 'input', id: 'new-character-name', type: 'text',
    placeholder: 'Character (optional)', autocomplete: 'off',
  });
  const player = el('input', {
    class: 'input', id: 'new-character-player', type: 'text',
    placeholder: 'Player', autocomplete: 'off',
  });
  const level = el('input', {
    class: 'input', id: 'new-character-level', type: 'number', min: '-1', max: '25', value: '1',
  });

  const add = () => {
    // Either will do. A GM setting up a game usually knows who is playing
    // before they know who anybody is playing, so a player's name on its own
    // is enough to make a row and hand out a link; the character names itself
    // when the player imports or types it.
    if (!name.value.trim() && !player.value.trim()) { player.focus(); return; }
    actions.addCharacter({
      name: name.value.trim(),
      playerName: player.value.trim(),
      level: Number(level.value) || 1,
    });
    name.value = '';
    player.value = '';
    player.focus();
  };

  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'Roster')),

    el('p', { class: 'muted' },
      'A player’s name is enough. The character starts empty, and the player '
      + 'fills it in or imports it from Pathbuilder — including its name. Make '
      + 'their link below once the row exists; the link stays theirs whatever '
      + 'they end up calling the character.'),

    characters.length
      ? el('ul', { class: 'roster' }, ...characters.map((character) => el('li', { class: 'roster__row' },
        el('div', {},
          el('strong', { class: isUnnamed(character) ? 'faint' : null },
            displayName(character)),
          el('span', { class: 'faint' },
            [
              // The player's name is already in the display name when the
              // character has none of its own; repeating it reads as a stutter.
              isUnnamed(character) ? 'not named yet' : character.playerName,
              character.class,
              `Level ${character.level}`,
            ].filter(Boolean).join(' · '))),
        el('button', {
          class: 'btn btn--icon btn--quiet roster__remove', type: 'button',
          title: 'Remove',
          html: `${icon('x')}<span class="sr-only">Remove ${displayName(character)}</span>`,
          onclick: () => actions.removeCharacter(character),
        }))))
      : el('p', { class: 'faint' }, 'Nobody yet.'),

    el('form', {
      class: 'roster__add',
      onsubmit: (event) => { event.preventDefault(); add(); },
    },
    field('Character', name),
    field('Player', player),
    field('Level', level),
    el('button', {
      class: 'btn btn--primary', type: 'submit',
      html: `${icon('plus')}<span>Add</span>`,
    })));
}

/**
 * The session log.
 *
 * Written between games, so nothing here autosaves on a debounce the way the
 * rest of the dashboard does: a half-finished sentence about last week should
 * not be committed because someone paused to think.
 */
export function sessionsPanel({ sessions, actions }) {
  const title = el('input', {
    class: 'input', id: 'session-title', type: 'text',
    placeholder: 'What happened', autocomplete: 'off',
  });
  const playedAt = el('input', {
    class: 'input', id: 'session-date', type: 'date',
    value: new Date().toISOString().slice(0, 10),
  });
  const body = el('textarea', {
    class: 'input', id: 'session-body', rows: '4',
    placeholder: 'The party finally opened the sealed door…',
  });

  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'Session log')),

    el('form', {
      class: 'session-add',
      onsubmit: (event) => {
        event.preventDefault();
        if (!title.value.trim() && !body.value.trim()) return;
        actions.addSession({
          title: title.value.trim(),
          body: body.value,
          playedAt: playedAt.value,
        });
        title.value = '';
        body.value = '';
      },
    },
    el('div', { class: 'session-add__head' },
      field('Session', title),
      field('Played', playedAt)),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'session-body' }, 'Notes'),
      body),
    el('button', { class: 'btn btn--primary', type: 'submit' },
      'Save this session')),

    sessions.length
      ? el('ol', { class: 'sessions' }, ...sessions.map((session) => el('li', { class: 'session' },
        el('div', { class: 'session__head' },
          el('strong', {}, session.title || 'Untitled session'),
          el('time', { class: 'faint', datetime: session.playedAt }, session.playedAt),
          el('button', {
            class: 'btn btn--icon btn--quiet', type: 'button',
            html: `${icon('x')}<span class="sr-only">Delete the session on ${session.playedAt}</span>`,
            onclick: () => actions.removeSession(session),
          })),
        session.body
          ? el('p', { class: 'session__body' }, session.body)
          : null)))
      : el('p', { class: 'faint stack-md' }, 'Nothing written down yet.'));
}
