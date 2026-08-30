/**
 * Adventure definition: Nine Minutes to the Toast.
 *
 * Pure data. No DOM, no imports, no side effects. Swap this object to run a
 * different looping adventure in the same console.
 *
 * Persistence contract, and the reason this module exists:
 *   - `known` on a fault PERSISTS across loops (the party remembers)
 *   - `fixed` on a fault RESETS every loop (the world does not)
 *   - influence `points` RESET; `highWater` PERSISTS
 * Tracking that split by hand is the actual bookkeeping burden of this
 * adventure, and it is what the console is for.
 */

export const ADVENTURE = {
  id: 'nine-minutes-to-the-toast',
  title: 'Nine Minutes to the Toast',
  subtitle: 'Level 12 · 3 PCs · loop console',

  loop: {
    slots: 9,
    startLabel: '7:51',
    endLabel: '8:00',
    // Fires when the clock REACHES this slot.
    events: [
      { slot: 7, label: 'Aspic', tone: 'amber', note: 'The aspic heaves off the sideboard. Every loop, no exceptions.' },
      { slot: 9, label: 'Toast', tone: 'ember', note: 'Duke Ansel rises. Then the fire.' }
    ]
  },

  // Default roster. Editable at runtime; player names are stored in state.
  party: ['PC 1', 'PC 2', 'PC 3'],

  faults: [
    {
      id: 'wine',
      n: 'I',
      name: 'The wine is a fake',
      summary: 'The decanter should hold the 4413 Vairemont Reserve. It holds table wine with a fig in it.',
      discovery: [
        'DC 25 Perception or relevant Lore to taste or smell it',
        'Read aura shows the preservation magic absent',
        'Havel confirms it instantly if asked'
      ],
      routes: [
        { label: 'Offer not to tell anyone', dc: 'DC 28 Diplomacy or Deception', note: 'The solve.' },
        { label: 'Promise the toast will name her', dc: 'DC 25', note: 'Best outcome — she volunteers Fault III.' },
        { label: 'Tell Hestia she was wrong', dc: 'Automatic failure', note: 'She attacks.', bad: true },
        { label: 'Kill her and find the wall alone', dc: 'DC 35 Perception, then DC 30 Thievery', note: '+5 DC on all later social checks with her.', bad: true }
      ]
    },
    {
      id: 'guest',
      n: 'II',
      name: 'Twelve at an eleven-person table',
      summary: '"Baron Willem Ostrejk" is Piotr Hallow, a food critic with a forged letter, having the best night of his life.',
      discovery: [
        'DC 30 Perception or Society to notice the count',
        'DC 32 Deception or Diplomacy to catch him in conversation',
        'Forged letter in the Gift Room — DC 25 Thievery or Perception',
        'Zone of truth exposes him outright'
      ],
      routes: [
        { label: 'Blackmail him out', dc: 'DC 28 Intimidation', note: 'He will not go willingly.' },
        { label: 'Legitimize him', dc: 'Duke at 4+ influence', note: 'Better ending. He helps in later loops.' }
      ]
    },
    {
      id: 'aspic',
      n: 'III',
      name: 'The dessert is alive',
      summary: 'Preserved and re-served since 4413. At 7:57 it heaves off the sideboard as a tallow ooze.',
      discovery: [
        'It happens at slot 7 of every loop, in front of everyone',
        'Havel knows its history and that it comes from the cold room'
      ],
      routes: [
        { label: 'Remove it before 7:57', dc: '2 slots + DC 28 Athletics', note: 'Comedy peak of the session.' },
        { label: 'Dispel the preservation', dc: 'Dispel magic vs rank 4', note: 'GM ruling on the rank. Reward this.' },
        { label: 'Kill the parent in the cold room', dc: 'Carnivorous Blob, Moderate', note: 'PERMANENT — survives every reset.', sticky: true }
      ]
    },
    {
      id: 'duke',
      n: 'IV',
      name: 'The Duke does not approve',
      summary: 'Warm for four sentences, and then he says the thing about Perpetua Wend.',
      discovery: [
        'DC 30 Society, DC 28 Perception, DC 25 any Lore',
        'Mind reading gets the content but not the fix'
      ],
      routes: [
        { label: 'Reach 8 influence points', dc: 'See the influence track', note: 'He accepts a replacement line.' }
      ],
      influence: true
    }
  ],

  influence: {
    target: 'Duke Ansel Vairemont',
    stats: 'Noncombat level 12 · Perception +20 · Will +22',
    max: 8,
    skills: [
      { name: 'Lore (Wine)', dc: 25 },
      { name: 'Crafting', dc: 28 },
      { name: 'Intimidation', dc: 28 },
      { name: 'Diplomacy', dc: 30 },
      { name: 'Performance', dc: 32 }
    ],
    discovery: [
      { name: 'Society', dc: 30 },
      { name: 'Perception', dc: 28 },
      { name: 'Any Lore', dc: 25 }
    ],
    thresholds: [
      { at: 2, label: 'Admits the speech "may run long."' },
      { at: 4, label: 'Shows the written toast. Will add a guest to the list.' },
      { at: 6, label: 'Explains the Perpetua problem. Permits a wedding (Route B).' },
      { at: 8, label: 'Accepts a replacement line. FAULT IV FIXED.' }
    ],
    resistance: { label: 'Appeals "for Iolanthe\'s sake"', mod: '+5 DC' },
    weakness: { label: 'Wine, the estate, or the 4413', mod: '−5 DC' },
    houseRule:
      'One slot on the Duke = one influence round action. Points reset with the loop, ' +
      'but any threshold already reached is restored for a single slot with no check.'
  },

  // Encounter XP is costed for 3 PCs at level 12:
  // Trivial 30 / Low 40 / Moderate 60 / Severe 90 / Extreme 120
  statblocks: [
    {
      id: 'tallow',
      name: 'Tallow Ooze',
      level: 11,
      xp: '30 XP · Trivial',
      source: 'Pathfinder #154 pg. 83',
      defense: 'AC 19 · Fort +22, Ref +10, Will +13 · HP 270',
      traits: ['Medium', 'Mindless', 'Ooze'],
      immune: 'acid, critical hits, mental, piercing, precision, slashing, unconscious, visual',
      resist: 'cold 10',
      weak: 'fire 10',
      speed: '20 ft, swim 20 ft',
      attacks: [
        'Pseudopod +23, 2d10+10 bludgeoning plus residual grease',
        'Engulf (2 actions) DC 30, 4d10 bludgeoning, Escape DC 26, Rupture 25'
      ],
      abilities: [
        'Congealed (reaction) — fire makes it quickened 1; cold, even if resisted, slows it 1 and blocks Engulf',
        'Greasy Seepage (aura 10 ft) — DC 30 Acrobatics; a creature that Steps does not roll',
        'Residual Grease — DC 30 Reflex when wielding items for 1d4 rounds; drop on crit fail'
      ],
      gmNote: 'A social disaster, not a fight. 270 HP and immune to blades. Drawing a weapon at the table creates a DIFFERENT imperfection.'
    },
    {
      id: 'hestia',
      name: 'Great-Aunt Hestia',
      level: 11,
      xp: '30 XP · Trivial',
      source: 'Ghost Mage (Monster Core) + Elite',
      defense: 'AC 29 · Fort +18, Ref +21, Will +24 · HP 155',
      traits: ['Incorporeal', 'Spirit', 'Undead', 'Elite'],
      immune: 'bleed, death effects, disease, paralyzed, poison, precision, unconscious',
      resist: 'all damage 10 except force, ghost touch, spirit, vitality — doubled vs non-magical',
      weak: '—',
      speed: 'fly 25 ft',
      attacks: [
        'Ghostly hand +23, 2d8+14 void',
        'Spell DC 31, attack +25'
      ],
      abilities: [
        'Site Bound — cannot leave the cellar',
        'Rejuvenation — 2d4 days, so the loop reset is what brings her back',
        'Frightful Moan DC 31 Will, 30 ft, frightened 2',
        'Telekinetic Assault DC 31 basic Reflex, 6d6 bludgeoning'
      ],
      gmNote: 'Three level-12 PCs kill her in two or three rounds. The lock is not her HP — it is that killing her does not get them the wine.'
    },
    {
      id: 'blob',
      name: 'Carnivorous Blob',
      level: 13,
      xp: '60 XP · Moderate',
      source: 'Monster Core 2 pg. 243',
      defense: 'AC 20 · Fort +25, Ref +14, Will +19 · HP 300',
      traits: ['Gargantuan', 'Mindless', 'Ooze'],
      immune: 'acid, bleed, critical hits, mental, piercing, precision, slashing, sonic, unconscious, visual',
      resist: '—',
      weak: '—',
      speed: '20 ft, climb 20 ft, swim 20 ft',
      attacks: [
        'Pseudopod +25, 2d12+12 bludgeoning plus 2d6 acid, Grab',
        'Constrict 2d12 bludgeoning plus 2d6 acid, DC 33',
        'Engulf (2 actions) DC 33, 4d10 acid, Escape DC 33, Rupture 20'
      ],
      abilities: [
        'SPLIT — hit by piercing or slashing at 10+ HP and it becomes two oozes at half HP each. The attack does nothing and doubles the problem.',
        'Retaliating Strike (reaction) — Strike an adjacent creature on taking damage',
        'Acid — DC 33 Fortitude or drained'
      ],
      gmNote: 'The real combat, and it is a puzzle. Killing it permanently stops the aspic re-forming. Tell them it stuck.'
    },
    {
      id: 'qazrahin',
      name: 'Qazrahin the Fastidious',
      level: 14,
      xp: '80 XP · +10 for the scorpion = 90, Severe',
      source: 'Ifrit Shuyookh, Rage of Elements pg. 129',
      defense: 'AC 36 · Fort +26, Ref +23, Will +27 · HP 300',
      traits: ['Rare', 'Large', 'Elemental', 'Fire', 'Genie'],
      immune: 'fire',
      resist: '—',
      weak: 'cold 15, water 15',
      speed: '25 ft, fly 35 ft',
      attacks: [
        'Scimitar +31, 2d6+16 slashing plus 4d6 fire (reach 10 ft, forceful, sweep)',
        'Fist +29, 1d4+16 bludgeoning plus 4d6 fire (agile, reach 10 ft)',
        'Spells DC 35, attack +27 — volcanic eruption, fireball (at will), invisibility ×2'
      ],
      abilities: [
        'Heat of Blazing Wings (aura 5 ft) — 4d6 fire, DC 31 basic Reflex',
        'Burning Grasp — 4d6 fire immediately and at end of each turn while grabbed',
        'Exploit Regret (reaction) — on a miss, offers the attacker a chance to express regret; if accepted it takes the damage and becomes quickened 1d4 rounds',
        'Change Shape — Small or Medium fire elemental or reptile'
      ],
      gmNote: 'THE ROOM IS THE ANSWER. Weak cold 15 and water 15, in a room full of ice buckets and chilled wine described in loop 1. If nobody notices by round three, have Havel hand a PC an ice bucket without comment. Do NOT teleport away.'
    }
  ],

  prompts: [
    { id: 'havel', label: 'Havel remembers', text: 'Havel refills a glass and says something that only makes sense if he remembers. He has served through every incineration with his composure intact. He will not raise it himself — it is not his place.' },
    { id: 'allocation', label: 'Name the real puzzle', text: '"The puzzle is allocation, not discovery." Say it out loud after loop 2. Twenty-seven actions per loop against four times that much to do.' },
    { id: 'reset-full', label: 'They reset to full', text: 'Full HP, all slots, all focus, consumables restored, conditions cleared, looted items back where they were. Say it plainly — it converts the loop from horror into a playground.' },
    { id: 'ledger', label: 'Pressure valve: the ledger', text: 'Qazrahin sits down in the twelfth chair and hands over a ledger naming all four faults, in order, with tally marks for how many loops each has ruined. It is not helping. It is complaining. Then it takes the ledger back, apologizes, and resets the room.' },
    { id: 'trap', label: 'The Guest List Trap', text: 'A PC seated as a guest becomes protected, and starts forgetting at the next reset. Play it straight, do not warn them, and do not do it twice.' },
    { id: 'routeb', label: 'Route B exists', text: 'The contract binds BETROTHAL feasts. It says nothing about WEDDING feasts. Pell has a copy in his case. DC 28 Society or any legal Lore.' }
  ]
};
