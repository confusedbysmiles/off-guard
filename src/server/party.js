/**
 * The party, as the GM needs to see it.
 *
 * Every number here is computed by the rules engine from the character sheets,
 * not stored: the party panel and the encounter budget have to agree with what
 * the player is looking at, and the only way to guarantee that is to run the
 * same arithmetic.
 */
import { armorClass, effectsOn, statistic } from '../rules/index.js';
import { listCharacters } from './store/characters.js';
import { campaignFor } from './scope.js';
import { getCampaign } from './store/campaigns.js';

const SKILLS = [
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy',
  'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion',
  'society', 'stealth', 'survival', 'thievery',
];

const SKILL_ATTRIBUTE = {
  acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int',
  deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
  nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis',
  society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
};

/** A sheet is stale when nobody has touched it for this long. */
const STALE_DAYS = 21;

const read = (sheet, path, fallback = undefined) => String(path).split('.').reduce(
  (node, key) => (node === null || node === undefined ? undefined : node[key]),
  sheet,
) ?? fallback;

function describeCharacter(row, { partyLevel, now }) {
  const sheet = row.sheet ?? {};
  const level = Number(sheet.level ?? row.level ?? 1);
  const mod = (key) => Number(read(sheet, `abilities.${key}`, 0));

  /**
   * What is in play on this character right now.
   *
   * The panel shows what the player is looking at, which means the effects and
   * conditions have to be folded in here too -- a GM reading a Will save of
   * +12 off this panel while the player reads +10 off their phone is the
   * failure the whole "computed, never stored" rule exists to prevent.
   */
  const effects = effectsOn(sheet);
  const own = Array.isArray(sheet.effects) ? sheet.effects : [];
  const before = {};
  const withEffects = (target, result) => {
    const { total } = effects.on(target);
    if (!total) return result.total;
    before[target] = result.total;
    return result.total + total;
  };

  const stat = (attribute, path) => statistic({
    attributeMod: mod(attribute),
    rank: read(sheet, `${path}.rank`, 'untrained'),
    level,
    itemBonus: Number(read(sheet, `${path}.itemBonus`, 0)),
    other: Number(read(sheet, `${path}.other`, 0)),
    override: read(sheet, `${path}.override`, null),
  });

  const ac = armorClass({
    dexMod: mod('dex'),
    dexCap: read(sheet, 'ac.dexCap', null),
    rank: read(sheet, 'ac.rank', 'untrained'),
    level,
    itemBonus: Number(read(sheet, 'ac.itemBonus', 0)),
    other: Number(read(sheet, 'ac.other', 0)),
    shieldBonus: Number(read(sheet, 'shield.bonus', 0)),
    shieldRaised: Boolean(read(sheet, 'shield.raised', false)),
    override: read(sheet, 'ac.override', null),
  });

  const hpMax = Number(read(sheet, 'hp.max', 0));
  /**
   * Drained lowers the maximum, not just the current total, so a drained
   * character's bar is shorter rather than merely emptier. Floored at zero:
   * a maximum below it is not a thing the panel can draw.
   */
  const effectiveHpMax = Math.max(0, hpMax + effects.hpMaxPenalty);
  if (effectiveHpMax !== hpMax) before['hp.max'] = hpMax;
  const hpCurrent = read(sheet, 'hp.current', null);
  const updatedAt = row.updatedAt ? new Date(`${row.updatedAt.replace(' ', 'T')}Z`) : null;
  const daysSinceEdit = updatedAt ? Math.floor((now - updatedAt) / 86_400_000) : null;

  return {
    id: row.id,
    // Raw, and possibly empty: a character can exist before it is named, and
    // every surface decides for itself what to call one — see
    // `src/shared/character-name.js`. Flattening it here to 'Unnamed' is what
    // used to stop the roster telling a GM which row was still waiting.
    name: sheet.name || row.name || '',
    playerName: sheet.playerName || row.playerName || '',
    class: sheet.class ?? '',
    level,
    ac: withEffects('ac', ac),
    hp: {
      current: hpCurrent === null ? effectiveHpMax : Number(hpCurrent),
      max: effectiveHpMax,
      temp: Number(read(sheet, 'hp.temp', 0)),
    },
    perception: withEffects('perception', stat('wis', 'perception')),
    saves: {
      fortitude: withEffects('saves.fortitude', stat('con', 'saves.fortitude')),
      reflex: withEffects('saves.reflex', stat('dex', 'saves.reflex')),
      will: withEffects('saves.will', stat('wis', 'saves.will')),
    },
    skills: Object.fromEntries(SKILLS.map((skill) => [
      skill,
      withEffects(`skills.${skill}`, stat(SKILL_ATTRIBUTE[skill], `skills.${skill}`)),
    ])),
    /**
     * What is running, and what each number was without it.
     *
     * `before` is only populated for the numbers that actually moved, so a
     * character with nothing on them carries nothing extra and the panel can
     * tell "unaffected" from "affected by zero".
     */
    effects: effects.any || own.length
      ? {
        /**
         * The sheet's own list, in full.
         *
         * So the dashboard can add one without reading the sheet first -- and
         * so an effect the player has turned off is still visible to the GM,
         * which `names` deliberately leaves out.
         */
        own,
        names: effects.names,
        before,
      }
      : null,
    heroPoints: Number(read(sheet, 'heroPoints', 0)),
    conditions: read(sheet, 'conditions', []) ?? [],
    updatedAt: row.updatedAt,
    /**
     * Two ways a sheet goes wrong quietly, both worth a flag rather than a
     * silent wrong number in the encounter budget.
     */
    flags: [
      ...(daysSinceEdit !== null && daysSinceEdit >= STALE_DAYS
        ? [{ kind: 'stale', detail: `Not touched for ${daysSinceEdit} days` }] : []),
      ...(level < partyLevel
        ? [{ kind: 'behind', detail: `Level ${level}, party is ${partyLevel}` }] : []),
      ...(hpMax === 0 ? [{ kind: 'empty', detail: 'No hit points recorded' }] : []),
    ],
  };
}

/**
 * The party panel.
 *
 * `partyLevel` is the campaign's, but the *effective* level used for encounter
 * maths is the median of the characters actually on the sheets -- a campaign
 * whose level field was never updated should not silently price encounters
 * against a number nobody is playing.
 */
export function partyFor(db, scope, requestedCampaignId = null, { now = Date.now() } = {}) {
  const campaignId = campaignFor(scope, requestedCampaignId);
  const campaign = getCampaign(db, scope, campaignId);
  const rows = listCharacters(db, scope, campaignId);

  const characters = rows.map((row) => describeCharacter(row, {
    partyLevel: campaign.partyLevel, now,
  }));

  const levels = characters.map((c) => c.level).sort((a, b) => a - b);
  const median = levels.length
    ? levels[Math.floor((levels.length - 1) / 2)]
    : campaign.partyLevel;

  return {
    campaign: { id: campaign.id, name: campaign.name, partyLevel: campaign.partyLevel },
    characters,
    size: characters.length,
    /** What the encounter builder should use unless the GM overrides it. */
    effectiveLevel: median,
    levelDisagrees: median !== campaign.partyLevel,
  };
}
