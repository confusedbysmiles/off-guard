/**
 * The links.
 *
 * Every way into this application is a URL, and this is where they are made and
 * unmade. Three kinds: the GM's own, one shared screen per campaign, and one
 * per player.
 *
 * The panel cannot show you a link you already made. Tokens are stored hashed,
 * so there is nothing to read back -- what is listed here is that a link exists
 * and what it reaches, and the only way to see one again is to rotate it and
 * hand out the new one. That is the trade hashing makes, and this panel is
 * built around it rather than apologising for it: a fresh link is shown once,
 * large, with a copy button, and the dialog says plainly that it will not be
 * shown again.
 */
import { displayName } from '../../../../engine/shared/character-name.js';
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { mount } from '../../lib/mount.js';

/** The whole URL, which is what gets pasted into a group chat. */
export const linkUrl = (kind, token) => `${location.origin}${mount}/${kind}/${token}`;

const PATH_FOR = { gm: 'gm', character: 'c', table: 'table' };

const relative = (iso) => {
  if (!iso) return 'never used';
  const days = Math.floor((Date.now() - new Date(`${iso}Z`).getTime()) / 86400000);
  if (Number.isNaN(days)) return 'never used';
  if (days <= 0) return 'used today';
  if (days === 1) return 'used yesterday';
  return `last used ${days} days ago`;
};

function row({ title, subtitle, meta, actions, below = null }) {
  return el('div', { class: 'link-row' },
    el('div', { class: 'link-row__what' },
      el('strong', {}, title),
      subtitle ? el('span', { class: 'faint' }, subtitle) : null,
      meta ? el('span', { class: 'faint' }, meta) : null),
    el('div', { class: 'link-row__tools' }, ...actions.filter(Boolean)),
    below);
}

const seen = (iso) => {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(`${iso}Z`).getTime()) / 86400000);
  if (Number.isNaN(days)) return '';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
};

/**
 * Which devices have opened this link.
 *
 * The question worth asking of a link is "has anybody else opened this", and
 * until now nothing in the application could answer it. A player's link should
 * show one device; two is either a phone and a laptop, which the GM knows
 * about, or it is not, which they would want to.
 *
 * Locking is the second half and is off by default on every link. It is
 * offered here rather than somewhere safer because the decision only makes
 * sense beside the list it acts on.
 */
function devices(token, { actions, subject }) {
  if (!token) return null;
  const list = token.devices ?? [];
  const locked = Boolean(token.lockedAt);

  return el('div', { class: `link-devices${locked ? ' link-devices--locked' : ''}` },
    el('div', { class: 'link-devices__head' },
      el('span', { class: 'faint' },
        list.length
          ? `${list.length} device${list.length === 1 ? '' : 's'}${locked ? ', locked to them' : ''}`
          : 'not opened yet'),
      list.length
        ? el('button', {
          class: 'btn btn--quiet', type: 'button',
          html: `${icon(locked ? 'eye' : 'shield')}<span>${locked ? 'Unlock' : 'Lock to these'}</span>`,
          title: locked
            ? 'Accept any device again, and keep recording them'
            : 'Refuse every device except the ones below',
          onclick: () => actions.setLinkLocked(token.id, !locked, subject),
        })
        : null),

    list.length
      ? el('ul', { class: 'link-devices__list' }, ...list.map((device) => el('li', {},
        el('span', {}, device.label || 'Unknown device'),
        el('span', { class: 'faint' },
          [seen(device.firstSeenAt) && `first ${seen(device.firstSeenAt)}`,
            seen(device.lastSeenAt) && `last ${seen(device.lastSeenAt)}`]
            .filter(Boolean).join(' · ')),
        el('button', {
          class: 'btn btn--icon btn--quiet', type: 'button',
          title: locked ? 'Refuse this device from now on' : 'Forget this device',
          html: `${icon('x')}<span class="sr-only">Forget ${device.label || 'this device'}</span>`,
          onclick: () => actions.forgetDevice(token.id, device.id, device.label),
        }))))
      : null);
}

const rotateButton = (label, onClick) => el('button', {
  class: 'btn', type: 'button',
  html: `${icon('undo')}<span>${label}</span>`,
  onclick: onClick,
});

/**
 * @param {object} options
 * @param {object[]} options.tokens    from the API: what exists, never the value
 * @param {object[]} options.characters the party, so a player with no link shows one
 */
export function linksPanel({ tokens, characters, actions, me = null }) {
  const byKind = (kind) => tokens.filter((t) => t.kind === kind);
  const table = byKind('table')[0] ?? null;
  const characterTokens = new Map(byKind('character').map((t) => [t.characterId, t]));

  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'Links')),

    el('p', { class: 'muted' },
      'A link is shown once, when it is made. Nothing here can show you one '
      + 'again — only the hash is stored — so if a player loses theirs, rotate '
      + 'it and send the new one.'),

    el('div', { class: 'links' },
      row({
        title: 'Shared screen',
        subtitle: table ? relative(table.lastUsedAt) : 'no link yet',
        meta: 'Read-only. Safe to cast to a television.',
        below: devices(table, { actions, subject: 'the shared screen' }),
        actions: [
          table
            ? rotateButton('Rotate', () => actions.rotateLink(table.id, 'the shared screen'))
            : el('button', {
              class: 'btn btn--primary', type: 'button',
              html: `${icon('plus')}<span>Make a link</span>`,
              onclick: () => actions.mintTableLink(),
            }),
        ],
      }),

      ...characters.map((character) => {
        const existing = characterTokens.get(character.id);
        return row({
          title: displayName(character),
          subtitle: character.playerName || 'no player named',
          meta: existing ? relative(existing.lastUsedAt) : 'no link yet',
          below: devices(existing, { actions, subject: displayName(character) }),
          actions: [
            existing
              ? rotateButton('Rotate', () => actions.rotateLink(existing.id, displayName(character)))
              : el('button', {
                class: 'btn btn--primary', type: 'button',
                html: `${icon('plus')}<span>Make a link</span>`,
                onclick: () => actions.mintCharacterLink(character.id, displayName(character)),
              }),
          ],
        });
      }),

      characters.length ? null : el('p', { class: 'faint' }, 'No characters in this campaign yet.')),

    el('details', { class: 'links__gm' },
      el('summary', {}, 'Your own link'),
      el('p', { class: 'muted' },
        'One GM link reaches every campaign. Rotating it signs you out of this '
        + 'tab immediately — the new link is shown first, and you will need it '
        + 'to get back in.'),
      rotateButton('Rotate my GM link', () => actions.rotateGmLink()),
      devices(me, { actions, subject: 'your GM link' }),
      me?.lockedAt
        ? el('p', { class: 'faint' },
          'Locked. If you are ever shut out of this dashboard, '
          + 'npm run unlock on the server is the way back in.')
        : null));
}

/**
 * The one time a link is visible.
 *
 * Selected on open so it can be copied with a keystroke by anyone whose browser
 * refuses the clipboard API, and read out loud legibly by anyone at a table:
 * Crockford base32 has no I, L, O or U, so there is nothing to mishear.
 */
export function linkReveal(kind, token, { subject = null } = {}) {
  const url = linkUrl(PATH_FOR[kind] ?? kind, token);

  const field = el('input', {
    class: 'input link-reveal__url', type: 'text', readonly: true, value: url,
    'aria-label': 'The new link',
    onfocus: (event) => event.target.select(),
  });

  const copied = el('span', { class: 'faint', role: 'status', 'aria-live': 'polite' }, '');

  const copy = el('button', {
    class: 'btn btn--primary', type: 'button',
    html: `${icon('check')}<span>Copy</span>`,
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(url);
        copied.textContent = 'Copied.';
      } catch {
        // Insecure context, or permission refused. Selecting it is the fallback
        // every browser has had for thirty years.
        field.focus();
        field.select();
        copied.textContent = 'Press Ctrl/Cmd+C to copy.';
      }
    },
  });

  return el('div', { class: 'link-reveal' },
    el('h2', {}, subject ? `New link for ${subject}` : 'New link'),
    el('p', { class: 'notice-inline' },
      'This is the only time this link will be shown. Copy it now.'),
    el('div', { class: 'row-inline' }, field, copy),
    copied,
    el('p', { class: 'faint' },
      'Anyone with this link has what it reaches, so send it the way you would '
      + 'send a key. The old link stopped working the moment this one was made.'));
}
