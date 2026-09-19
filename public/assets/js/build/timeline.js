/**
 * The level timeline.
 *
 * The spine of the builder, and the reason planning is not a separate feature:
 * a level is a list of decisions, and a level above the character's current one
 * is the same list drawn quieter. Nothing about filling in level 12 differs
 * from filling in level 3 except that its consequences have not arrived yet.
 *
 * Every control here does one thing: it changes the build. Nothing computes a
 * statistic -- see the note in `state.js` -- so a slot that has been answered
 * looks answered, and what that answer is worth appears in the summary panel
 * after the server has said.
 */
import { el, debounce, titleCase } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

const ATTRIBUTES = [
  ['str', 'Str'], ['dex', 'Dex'], ['con', 'Con'],
  ['int', 'Int'], ['wis', 'Wis'], ['cha', 'Cha'],
];

const ATTRIBUTE_NAMES = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

const SKILLS = [
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy',
  'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion',
  'society', 'stealth', 'survival', 'thievery',
];

/**
 * Who the character is, as opposed to what level 1 gave them.
 *
 * Ancestry, heritage, background and class are not level choices -- nobody
 * "takes elf at 1st" -- and neither are the boosts and the key attribute those
 * four hand out. Putting them in a card of their own is what makes the page
 * read top to bottom the way a character is actually made: who they are, then
 * what each level adds. It also stops the first card being a wall of every
 * decision in the game with "Level 1" written over it.
 */
const IDENTITY_KINDS = new Set(['ancestry', 'heritage', 'background', 'class', 'keyAttribute']);
const isIdentity = (slot) => IDENTITY_KINDS.has(slot.kind)
  || (slot.kind === 'attributeBoosts' && (slot.section === 'ancestry' || slot.section === 'background'));

export function renderTimeline(host, { state, store, picker }) {
  const { derived } = state;
  if (!derived) {
    host.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
    return;
  }

  const levels = Object.keys(derived.byLevel).map(Number).sort((a, b) => a - b);
  const context = { store, picker, derived };
  const cards = [];

  for (const level of levels) {
    const slots = derived.byLevel[level] ?? [];
    const identity = level === 1 ? slots.filter(isIdentity) : [];
    const rest = level === 1 ? slots.filter((slot) => !isIdentity(slot)) : slots;

    if (identity.length) {
      cards.push(levelCard('character', 'Character', identity, context, false));
    }
    if (rest.length) {
      cards.push(levelCard(`level-${level}`, `Level ${level}`, rest, context, level > derived.level));
    }
  }

  host.replaceChildren(...cards);
}

/** One card: a heading, how much of it is unanswered, and its rows. */
function levelCard(id, title, slots, context, planned) {
  const open = slots.filter((slot) => slot.empty).length;

  return el('section', {
    class: `level${planned ? ' level--planned' : ''}`,
    'aria-labelledby': `${id}-heading`,
  },
  el('header', { class: 'level__head' },
    el('h3', { class: 'level__title', id: `${id}-heading` },
      title,
      planned ? el('span', { class: 'pill' }, 'Planned') : null),
    open
      ? el('span', { class: 'level__open' }, `${open} to choose`)
      : el('span', { class: 'level__open level__open--done' },
        el('span', { class: 'level__tick', html: icon('check') }), 'Complete')),
  el('div', { class: 'level__slots' },
    ...slots.map((slot) => renderSlot(slot, context))));
}

function renderSlot(slot, context) {
  switch (slot.kind) {
    case 'attributeBoosts': return boostSlot(slot, context);
    case 'keyAttribute': return keyAttributeSlot(slot, context);
    case 'trainedSkills': return trainedSkillsSlot(slot, context);
    case 'skillIncrease': return skillIncreaseSlot(slot, context);
    case 'background': return backgroundSlot(slot, context);
    default: return pickerSlot(slot, context);
  }
}

/** A slot answered from the catalogue: ancestry, class, a feat. */
function pickerSlot(slot, context) {
  // The visible text is "Choose…" on every one of these and the slot's name is
  // in a sibling, which is why the button carries an `aria-label`: without it
  // a screen reader reads a column of identical buttons.
  return slotShell(slot, pickerButton(slot, context),
    slot.blockedBy ? `Choose an ${slot.blockedBy} first.` : null);
}

/**
 * A background, chosen or written.
 *
 * The catalogue has 514 of them and a table still ends up needing one it does
 * not: a GM writes a background for their own setting, or a book lands before
 * the compendium build catches up. So this slot has the picker every other
 * identity slot has, and a way past it.
 *
 * What the player fills in is what the rules actually read -- two boosts, a
 * trained skill, a Lore -- and nothing else. The skill feat a background
 * grants is recorded and shown rather than applied, because this engine does
 * not apply a catalogue background's granted feat either. See
 * `customBackground`.
 */
const isDescribed = (filled) => Boolean(filled && typeof filled === 'object' && filled.custom);

function backgroundSlot(slot, context) {
  const { store } = context;
  const described = isDescribed(slot.filled) ? (slot.filled.custom ?? {}) : null;

  /**
   * `resetBoosts` for the fields that change what may be boosted. Picking a
   * new background clears the boosts chosen under the old one, and narrowing
   * the list a described one offers has to do the same -- otherwise a boost
   * into Strength survives Strength being taken off the list.
   */
  const write = (mutate, { resetBoosts = false } = {}) => store.update((build) => {
    const custom = { ...(build.background?.custom ?? {}) };
    mutate(custom);
    build.background = { custom };
    if (resetBoosts) build.attributes = { ...(build.attributes ?? {}), background: [] };
  });

  const describe = el('button', {
    class: 'btn btn--quiet', type: 'button',
    onclick: () => write(() => {}, { resetBoosts: true }),
  }, 'Describe your own');

  const drop = el('button', {
    class: 'btn btn--quiet custom__drop', type: 'button',
    onclick: () => store.update((build) => {
      build.background = null;
      build.attributes = { ...(build.attributes ?? {}), background: [] };
    }),
  }, 'Use the catalogue instead');

  return slotShell(slot,
    el('div', {},
      el('div', { class: 'equip-row' },
        pickerButton(slot, context),
        described ? null : describe),
      described ? describedBackground(described, { write, drop }) : null),
    slot.blockedBy ? `Choose an ${slot.blockedBy} first.` : null);
}

function describedBackground(custom, { write, drop }) {
  const chosen = new Set((custom.boosts ?? []).filter(Boolean));

  const field = (id, label, control) => el('label', { class: 'micro', for: id },
    el('span', { class: 'micro__label' }, label), control);

  const text = (id, label, key, placeholder, limit = 60) => field(id, label, el('input', {
    class: 'input', type: 'text', id, placeholder, maxlength: String(limit),
    value: custom[key] ?? '', 'aria-label': label,
    oninput: debounce((event) => {
      const value = event.target.value;
      write((next) => { next[key] = value || undefined; });
    }, 400),
  }));

  return el('div', { class: 'custom' },
    el('div', { class: 'custom__fields' },
      text('custom-background-name', 'Name', 'name', 'Caravan guard'),
      field('custom-background-skill', 'Trained skill', el('select', {
        class: 'input input--compact', id: 'custom-background-skill',
        'aria-label': 'Skill this background trains',
        onchange: (event) => {
          const value = event.target.value;
          write((next) => { next.skill = value || undefined; });
        },
      },
      el('option', { value: '', selected: !custom.skill }, 'None'),
      ...SKILLS.map((skill) => el('option', {
        value: skill, selected: custom.skill === skill,
      }, titleCase(skill))))),
      text('custom-background-lore', 'Lore', 'lore', 'Caravan Lore'),
      text('custom-background-feat', 'Skill feat', 'feat', 'Hefty Hauler')),

    /**
     * The boost a background narrows. The other one is free, always, so it is
     * stated rather than offered -- there is nothing here to decide about it.
     */
    el('p', { class: 'micro__label stack-md' }, 'Boost one of these, and one free'),
    el('div', {
      class: 'boosts', role: 'group',
      'aria-label': 'Attributes this background may boost',
    }, ...ATTRIBUTES.map(([key, short]) => {
      const on = chosen.has(key);
      return el('button', {
        class: `boost${on ? ' boost--on' : ''}`,
        type: 'button',
        'aria-pressed': String(on),
        'aria-label': ATTRIBUTE_NAMES[key] ?? key,
        onclick: () => write((next) => {
          const list = (next.boosts ?? []).filter(Boolean);
          next.boosts = on ? list.filter((a) => a !== key) : [...list, key];
        }, { resetBoosts: true }),
      }, short);
    })),
    el('p', { class: 'faint slot-row__hint' },
      chosen.size
        ? 'Leaving none selected would offer all six.'
        : 'None selected, so all six are offered.'),

    drop);
}

/** The picker button every identity slot shares. */
function pickerButton(slot, { picker }) {
  const label = slot.filledMissing
    ? `${slot.filled} — no longer in the catalogue`
    : (slot.filledName ?? 'Choose…');

  return el('button', {
    class: `slot-choice${slot.empty ? ' slot-choice--empty' : ''}${slot.filledMissing ? ' slot-choice--broken' : ''}`,
    type: 'button',
    disabled: Boolean(slot.blockedBy),
    'aria-label': `${slot.label}${slot.level > 1 ? `, level ${slot.level}` : ''}: ${
      slot.empty ? 'not yet chosen' : label}`,
    onclick: () => picker.open(slot, typeof slot.filled === 'string' ? slot.filled : null),
  },
  el('span', { class: 'slot-choice__value' }, label),
  el('span', { class: 'slot-choice__hint', html: icon('chevron') }));
}

/**
 * Attribute boosts.
 *
 * Toggles rather than a list of selects, because the question is "which four"
 * and the constraint is "not the same one twice" -- both of which a row of
 * toggles states without being explained.
 */
function boostSlot(slot, { store, derived }) {
  const chosen = Array.isArray(slot.filled) ? slot.filled : [];
  const full = chosen.length >= slot.count;

  // Where a boost is restricted -- an ancestry offering Strength or Wisdom --
  // only those may be picked.
  const allowed = new Set(
    (slot.options ?? []).flatMap((entry) => entry ?? ATTRIBUTES.map(([key]) => key)),
  );

  return slotShell(slot,
    el('div', {
      class: 'boosts', role: 'group',
      'aria-label': `${slot.label}, choose ${slot.count}`,
    }, ...ATTRIBUTES.map(([key, short]) => {
      const on = chosen.includes(key);
      const permitted = allowed.has(key);
      /**
       * The partial-boost rule, shown before it bites: a boost onto +4 or more
       * is worth half a point, and two are needed to move the number.
       *
       * Only on boosts *not* taken, because the marker answers "what would
       * picking this be worth?". On an already-chosen boost it would be read as
       * "this one was halved", which is a claim about the order boosts were
       * applied in that this marker cannot make.
       */
      const current = derived.attributes?.exact?.[key] ?? 0;
      const half = !on && current >= 4;

      // The visible label is three letters and the half-boost marker is a
      // glyph, so both are spelled out for anyone not looking at it.
      const hint = half ? ', already +4 or more, so this boost is worth half a point' : '';

      return el('button', {
        class: `boost${on ? ' boost--on' : ''}${half ? ' boost--half' : ''}`,
        type: 'button',
        disabled: !permitted || (!on && full),
        'aria-pressed': String(on),
        'aria-label': `${ATTRIBUTE_NAMES[key]}${hint}`,
        title: half ? `${ATTRIBUTE_NAMES[key]} is already +4 or more, so a boost is worth half a point` : null,
        onclick: () => store.update((build) => {
          const list = readBoosts(build, slot.section);
          const next = on ? list.filter((a) => a !== key) : [...list, key];
          writeBoosts(build, slot.section, next);
        }),
      },
      short,
      half ? el('span', { class: 'boost__half', 'aria-hidden': 'true' }, '½') : null);
    })),
    `${chosen.length} of ${slot.count} chosen.`);
}

const readBoosts = (build, section) => {
  build.attributes ??= {};
  return build.attributes[section] ?? [];
};
const writeBoosts = (build, section, value) => {
  build.attributes ??= {};
  build.attributes[section] = value;
};

function keyAttributeSlot(slot, { store }) {
  const options = (slot.options ?? [])[0] ?? [];
  return slotShell(slot,
    el('div', { class: 'boosts', role: 'group', 'aria-label': slot.label }, ...options.map((key) => el('button', {
      class: `boost${slot.filled === key ? ' boost--on' : ''}`,
      type: 'button',
      'aria-pressed': String(slot.filled === key),
      'aria-label': ATTRIBUTE_NAMES[key] ?? key,
      onclick: () => store.update((build) => {
        build.attributes ??= {};
        build.attributes.class = key;
      }),
    }, titleCase(key)))),
    options.length > 1 ? 'Your class offers a choice here.' : null);
}

function trainedSkillsSlot(slot, { store, derived }) {
  const chosen = Array.isArray(slot.filled) ? slot.filled : [];
  const full = chosen.length >= slot.count;
  // Skills already trained by the background or class are not choices, and
  // spending a choice on one is the mistake this marks rather than allows.
  const alreadyTrained = new Set(
    Object.entries(derived.sheet?.skills ?? {})
      .filter(([skill, value]) => value?.rank !== 'untrained' && !chosen.includes(skill))
      .map(([skill]) => skill),
  );

  return slotShell(slot,
    el('div', {
      class: 'skill-grid', role: 'group',
      'aria-label': `${slot.label}, choose ${slot.count}`,
    }, ...SKILLS.map((skill) => {
      const on = chosen.includes(skill);
      const free = alreadyTrained.has(skill);
      return el('button', {
        class: `skill-toggle${on ? ' skill-toggle--on' : ''}${free ? ' skill-toggle--free' : ''}`,
        type: 'button',
        disabled: free || (!on && full),
        'aria-pressed': String(on),
        'aria-label': free
          ? `${titleCase(skill)}, already trained by your background or class`
          : titleCase(skill),
        title: free ? 'Already trained by your background or class' : null,
        onclick: () => store.update((build) => {
          build.skills ??= {};
          const list = build.skills.trained ?? [];
          build.skills.trained = on ? list.filter((s) => s !== skill) : [...list, skill];
        }),
      }, titleCase(skill));
    })),
    `${chosen.length} of ${slot.count} chosen.`);
}

function skillIncreaseSlot(slot, { store, derived }) {
  const ranks = derived.sheet?.skills ?? {};
  return slotShell(slot,
    el('select', {
      class: 'input input--compact',
      'aria-label': `Skill increase at level ${slot.level}`,
      onchange: (event) => {
        const value = event.currentTarget.value;
        store.update((build) => {
          build.skills ??= {};
          build.skills.increases ??= {};
          if (value) build.skills.increases[slot.level] = value;
          else delete build.skills.increases[slot.level];
        });
      },
    },
    el('option', { value: '', selected: !slot.filled }, 'Choose…'),
    ...SKILLS.map((skill) => el('option', {
      value: skill, selected: slot.filled === skill,
    }, `${titleCase(skill)} — ${titleCase(ranks[skill]?.rank ?? 'untrained')}`))));
}

/** Every slot looks the same from the outside: a label, a control, a hint. */
function slotShell(slot, control, hint = null) {
  return el('div', { class: `slot-row${slot.empty ? ' slot-row--empty' : ''}` },
    el('div', { class: 'slot-row__label' },
      slot.label,
      slot.empty ? el('span', { class: 'slot-row__dot', 'aria-label': 'Not yet chosen' }) : null),
    el('div', { class: 'slot-row__control' },
      control,
      hint ? el('p', { class: 'faint slot-row__hint' }, hint) : null));
}
