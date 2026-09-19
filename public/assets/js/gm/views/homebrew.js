/**
 * Options this table wrote.
 *
 * The GM's side of the thing players see in their picker. Four kinds, one
 * panel, and a form that changes shape depending on which kind is being
 * written -- because an ancestry and a heritage have almost nothing in common
 * mechanically, and a form that showed every field for every kind would be
 * mostly disabled boxes.
 *
 * The guiding decision: only ask for what the engine can actually read. A
 * background's boosts, skill and Lore become numbers on a sheet, so they are
 * fields. What a heritage *does* is a feature, which this engine does not
 * apply for published heritages either -- so it is prose, and the form says so
 * rather than pretending a box will make it work.
 *
 * The one exception is a class, which is an advancement table twenty levels
 * deep. Nobody is typing that in. It is copied from a published class and the
 * handful of things that differ are overridden, which is what a homebrew class
 * at a table almost always is anyway.
 */
import { el, titleCase } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { ATTRIBUTES, ATTRIBUTE_NAMES } from '../../../../engine/rules/character/attributes.js';
import { SKILLS } from '../../../../engine/rules/character/derive.js';

const KINDS = [
  ['ancestry', 'Ancestry', 'Hit points, size, speed, the boosts it grants.'],
  ['heritage', 'Heritage', 'A name and the ancestry it belongs to.'],
  ['background', 'Background', 'Two boosts, a skill, a Lore.'],
  ['class', 'Class', 'Advances like a published one; the rest is yours.'],
];

const KIND_LABEL = Object.fromEntries(KINDS.map(([id, label]) => [id, label]));

const SIZES = [['tiny', 'Tiny'], ['sm', 'Small'], ['med', 'Medium'], ['lg', 'Large']];
const VISIONS = [
  ['normal', 'Normal'], ['low-light-vision', 'Low-light vision'], ['darkvision', 'Darkvision'],
];
const RARITIES = [['common', 'Common'], ['uncommon', 'Uncommon'], ['rare', 'Rare']];

// --- small form pieces --------------------------------------------------------

const field = (label, control, hint = null) => el('div', { class: 'field' },
  el('label', { class: 'field__label', for: control.id }, label),
  control,
  hint ? el('span', { class: 'faint' }, hint) : null);

const input = (id, value, attrs = {}) => el('input', {
  class: 'input', id, type: 'text', autocomplete: 'off', value: value ?? '', ...attrs,
});

const number = (id, value, attrs = {}) => el('input', {
  class: 'input', id, type: 'number', value: value ?? '', ...attrs,
});

const select = (id, options, current) => el('select', { class: 'input', id },
  ...options.map(([value, label]) => el('option', {
    value, selected: String(current ?? '') === String(value) ? true : null,
  }, label)));

/**
 * A row of checkboxes over a fixed vocabulary.
 *
 * A multi-select would be fewer pixels and worse: choosing three of sixteen
 * skills from one of those means knowing to hold a modifier key, and on a
 * touch screen it means nothing at all.
 */
function chooser(key, label, entries, chosen = [], { columns = null } = {}) {
  const boxes = entries.map(([value, text]) => {
    const id = `hb-${key}-${value}`;
    const box = el('input', {
      type: 'checkbox', id, value, checked: chosen.includes(value) ? true : null,
    });
    return { value, box, node: el('label', { class: 'chooser__item', for: id }, box, text) };
  });
  const node = el('div', {
    class: `chooser${columns ? ' chooser--grid' : ''}`, role: 'group', 'aria-label': label,
  }, ...boxes.map((b) => b.node));
  return { node, read: () => boxes.filter((b) => b.box.checked).map((b) => b.value) };
}

const ATTRIBUTE_ENTRIES = ATTRIBUTES.map((a) => [a, ATTRIBUTE_NAMES[a] ?? titleCase(a)]);
const SKILL_ENTRIES = SKILLS.map((s) => [s, titleCase(s)]);

/** `['ashen', 'humanoid']` <-> `ashen, humanoid` */
const commaList = (values) => (values ?? []).join(', ');
const fromComma = (value) => String(value ?? '').split(',').map((v) => v.trim()).filter(Boolean);

// --- the form -----------------------------------------------------------------

/**
 * The editor for one option, as a form element plus a `read()`.
 *
 * `read()` returns what the API takes rather than what the record looks like:
 * the server rebuilds the record from these fields every time, so the form
 * sends the same shape whether it is creating or replacing. See
 * `updateHomebrew`, which is a replace for this reason -- a field cleared here
 * has to clear on the record, and a merge would leave it behind.
 */
export function homebrewForm(kind, entry = null, bases = { classes: [], ancestries: [] }) {
  const record = entry?.record ?? {};
  const fields = [];
  const readers = {};

  const name = input('hb-name', record.name ?? '', { maxlength: '60', required: true });
  const rarity = select('hb-rarity', RARITIES, record.rarity ?? 'common');
  const traits = input('hb-traits', commaList(record.traits), { maxlength: '200' });
  const description = el('textarea', {
    class: 'input', id: 'hb-description', rows: '4', maxlength: '4000',
  }, record.description?.text ?? '');

  fields.push(field('Name', name));

  if (kind === 'ancestry') {
    const hp = number('hb-hp', record.hp ?? 8, { min: '0', max: '20' });
    const speed = number('hb-speed', record.speed ?? 25, { min: '0', max: '120', step: '5' });
    const size = select('hb-size', SIZES, record.size ?? 'med');
    const vision = select('hb-vision', VISIONS, record.vision ?? 'normal');
    const languages = input('hb-languages', commaList(record.languages), { maxlength: '200' });

    const granted = (record.boosts ?? []).filter((b) => !b.free).map((b) => b.options[0]);
    const free = (record.boosts ?? []).filter((b) => b.free).length;
    const boosts = chooser('boost', 'Attribute boosts it grants outright', ATTRIBUTE_ENTRIES, granted);
    const flaws = chooser('flaw', 'Attribute flaw', ATTRIBUTE_ENTRIES, record.flaws ?? []);
    const freeBoosts = number('hb-free-boosts', entry ? free : 1, { min: '0', max: '4' });

    fields.push(
      el('div', { class: 'hb-row' },
        field('Hit points', hp, 'Per level. Most ancestries are 6, 8 or 10.'),
        field('Speed', speed, 'Feet.'),
        field('Size', size)),
      field('Vision', vision),
      field('Languages', languages, 'Comma separated. Everyone also gets the ones their class or Intelligence grants.'),
      el('div', { class: 'field' },
        el('span', { class: 'field__label' }, 'Attribute boosts it grants outright'),
        boosts.node,
        el('span', { class: 'faint' }, 'A dwarf grants Constitution and Wisdom.')),
      field('Free boosts the player chooses', freeBoosts, 'Almost always one.'),
      el('div', { class: 'field' },
        el('span', { class: 'field__label' }, 'Attribute flaw'),
        flaws.node,
        el('span', { class: 'faint' }, 'Leave empty for an ancestry with no flaw.')));

    readers.ancestry = () => ({
      hp: hp.value, speed: speed.value, size: size.value, vision: vision.value,
      languages: fromComma(languages.value),
      boosts: boosts.read(), flaws: flaws.read(), freeBoosts: freeBoosts.value,
    });
  }

  if (kind === 'heritage') {
    const ancestry = select(
      'hb-ancestry',
      [['', 'Any — a versatile heritage'], ...bases.ancestries.map((a) => [a.id, a.name])],
      record.ancestry ? idForStrippedAncestry(record.ancestry, bases.ancestries) : '',
    );
    fields.push(field('Ancestry it belongs to', ancestry,
      'Leave it on "any" for a versatile heritage, which every ancestry may take.'));
    readers.heritage = () => ({ ancestry: ancestry.value || null });
  }

  if (kind === 'background') {
    const boosts = chooser('boost', 'First boost is one of', ATTRIBUTE_ENTRIES,
      (record.boosts?.[0]?.options ?? []).length === ATTRIBUTES.length
        ? [] : (record.boosts?.[0]?.options ?? []));
    const skill = select('hb-skill', [['', 'None'], ...SKILL_ENTRIES], record.trainedSkills?.[0] ?? '');
    const lore = input('hb-lore', record.trainedLore?.[0] ?? '', { maxlength: '60', placeholder: 'Caravan Lore' });
    const feat = input('hb-feat', record.grantedFeat ?? '', { maxlength: '60', placeholder: 'Hefty Hauler' });

    fields.push(
      el('div', { class: 'field' },
        el('span', { class: 'field__label' }, 'First boost is one of'),
        boosts.node,
        el('span', { class: 'faint' }, 'Two, usually. Leave all unticked for a free choice. The second boost is always free.')),
      field('Trained skill', skill),
      field('Lore', lore),
      field('Skill feat', feat,
        'Recorded and shown to the player, not applied — the same as a background out of a book.'));

    readers.background = () => ({
      boosts: boosts.read(), skill: skill.value || null,
      lore: lore.value, feat: feat.value,
    });
  }

  if (kind === 'class') {
    const basedOn = select(
      'hb-based-on',
      [['', 'Nothing — it never advances'], ...bases.classes.map((c) => [c.id, c.name])],
      record.basedOn?.id ?? '',
    );
    const hp = number('hb-hp', record.hp ?? 8, { min: '1', max: '20' });
    const key = chooser('key', 'Key attribute', ATTRIBUTE_ENTRIES, record.keyAttributes ?? []);
    const additional = number('hb-additional', record.trainedSkills?.additional ?? 3, { min: '0', max: '12' });
    const fixed = chooser('skill', 'Always trained in', SKILL_ENTRIES, record.trainedSkills?.fixed ?? [], { columns: true });

    fields.push(
      field('Advances like', basedOn,
        'Its proficiencies, feat levels and skill increases are copied from this class '
        + 'when you save — not linked to it, so a data rebuild cannot change a character mid-campaign.'),
      el('div', { class: 'hb-row' },
        field('Hit points', hp, 'Per level.'),
        field('Extra trained skills', additional, 'Before Intelligence.')),
      el('div', { class: 'field' },
        el('span', { class: 'field__label' }, 'Key attribute'),
        key.node,
        el('span', { class: 'faint' }, 'Tick more than one where the player chooses.')),
      el('div', { class: 'field' },
        el('span', { class: 'field__label' }, 'Always trained in'),
        fixed.node),
      el('p', { class: 'faint' },
        'Class features and the class feats it offers are prose, not arithmetic. '
        + 'Off-Guard does not apply a published class’s features either.'));

    readers.class = () => ({
      basedOn: basedOn.value || null, hp: hp.value,
      keyAttributes: key.read(), additionalSkills: additional.value, fixedSkills: fixed.read(),
    });
  }

  fields.push(
    el('div', { class: 'hb-row' }, field('Rarity', rarity), field('Traits', traits, 'Comma separated.')),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'hb-description' }, 'Description'),
      description,
      el('span', { class: 'faint' }, 'What the players read. Blank lines make paragraphs.')));

  const form = el('form', { class: 'hb-form', id: 'homebrew-form' }, ...fields);

  return {
    node: form,
    focus: () => name.focus(),
    read: () => ({
      kind,
      name: name.value.trim(),
      rarity: rarity.value,
      traits: fromComma(traits.value),
      description: description.value,
      ...(readers[kind]?.() ?? {}),
    }),
  };
}

/**
 * A heritage record stores its ancestry with the kind stripped off, the way
 * the catalogue does, so the select has to map back to a whole id to show what
 * is currently chosen.
 */
function idForStrippedAncestry(stripped, ancestries) {
  return ancestries.find((a) => String(a.id).replace(/^[a-z-]+:/, '') === stripped)?.id ?? '';
}

// --- the panel ----------------------------------------------------------------

/** One written option, as a row in the list. */
function optionRow(entry, { actions, onEdit }) {
  return el('li', { class: 'hb-item' },
    el('div', { class: 'hb-item__main' },
      el('strong', {}, entry.name),
      el('p', { class: 'faint hb-item__note' },
        entry.record?.description?.text ? summarise(entry) : mechanics(entry))),
    el('div', { class: 'hb-item__meta' },
      entry.usedBy
        ? el('span', { class: 'pill' },
          `${entry.usedBy} ${entry.usedBy === 1 ? 'character' : 'characters'}`)
        : null,
      el('button', { class: 'btn btn--quiet', type: 'button', onclick: () => onEdit(entry) }, 'Edit'),
      el('button', {
        class: 'btn btn--icon btn--quiet', type: 'button',
        html: `${icon('x')}<span class="sr-only">Delete ${entry.name}</span>`,
        onclick: () => confirmRemove(entry, actions),
      })));
}

/** The four "write a new one" buttons. */
function newButtons(onWrite) {
  return el('div', { class: 'hb-new' }, ...KINDS.map(([kind, label, hint]) => el('button', {
    class: 'btn hb-new__btn', type: 'button', onclick: () => onWrite(kind),
  },
  el('span', { class: 'hb-new__label', html: `${icon('plus')}<span>${label}</span>` }),
  el('span', { class: 'faint hb-new__hint' }, hint))));
}

export function homebrewPanel({ homebrew = [], actions, onWrite, onEdit }) {
  const groups = KINDS
    .map(([kind, label]) => [label, homebrew.filter((entry) => entry.kind === kind)])
    .filter(([, entries]) => entries.length)
    .map(([label, entries]) => el('div', { class: 'hb-group' },
      el('h3', { class: 'hb-group__title' }, label),
      el('ul', { class: 'hb-list' }, ...entries.map((entry) => optionRow(entry, { actions, onEdit })))));

  return el('section', { class: 'panel' },
    el('div', { class: 'panel__head' },
      el('h2', { class: 'panel__title' }, 'Options this table wrote')),

    el('p', { class: 'muted' },
      'These appear in your players’ pickers alongside the books, badged so they '
      + 'can tell which is which. They belong to this campaign and no other.'),

    newButtons(onWrite),
    ...groups,

    homebrew.length ? null : el('p', { class: 'faint stack-md' },
      'Nothing yet. Everything your players see comes out of the books.'));
}

/**
 * What a delete will actually do, said before it happens.
 *
 * A build that names an option which has gone shows it as a gap, the same way
 * a feat renamed by an upstream bump does -- so this is a warning rather than a
 * refusal. But "two characters have chosen this" is worth knowing first.
 */
function confirmRemove(entry, actions) {
  const chosen = entry.usedBy
    ? `\n\n${entry.usedBy} ${entry.usedBy === 1 ? 'character has' : 'characters have'} chosen it. `
      + 'Their builds will show it as a missing choice until they pick something else.'
    : '';
  // eslint-disable-next-line no-alert
  if (confirm(`Delete ${entry.name}?${chosen}`)) actions.removeHomebrew(entry);
}

/** The first line of the prose, for the list. */
function summarise(entry) {
  const text = entry.record.description.text.split('\n')[0];
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

/** Something true about it, where there is no prose to show instead. */
function mechanics(entry) {
  const record = entry.record ?? {};
  if (entry.kind === 'ancestry') return `${record.hp} HP, ${record.sizeName}, speed ${record.speed}`;
  if (entry.kind === 'heritage') return record.ancestryName ? `${record.ancestryName} heritage` : 'Versatile heritage';
  if (entry.kind === 'background') {
    return [record.trainedSkills?.[0] && titleCase(record.trainedSkills[0]), record.trainedLore?.[0]]
      .filter(Boolean).join(', ') || 'No training';
  }
  if (entry.kind === 'class') {
    return record.basedOn ? `${record.hp} HP, advances like ${record.basedOn.name}` : `${record.hp} HP`;
  }
  return '';
}

export { KIND_LABEL };
