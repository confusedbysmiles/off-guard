/**
 * Nine Minutes to the Toast.
 *
 * An adventure definition for the loop console: pure data, no DOM, no imports.
 * Drop another file beside this one and the console runs that instead -- the
 * console knows about loops, faults and influence, and nothing about wine.
 *
 * `id` is what the server keys the run on, so changing it orphans a run in
 * progress. Everything else is safe to edit mid-campaign.
 *
 * The persist/reset split the console exists to track lives in
 * `src/shared/loop.js`, not here.
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



  /**
   * The ten beats that carry the session.
   *
   * Not a plot outline. A checklist of moments, each with a way to tell it
   * landed and a lever for when it has not -- because a beat that does not land
   * is not something the party failed, it is something the GM has to hand them.
   *
   * These persist across resets. A beat lands once, in the whole evening, which
   * is the one piece of progress here that is neither a fault nor a fix.
   */
  beats: [
    { id: 'soup', n: 1, act: 'I', name: 'The soup is fine',
      when: 'Cold open',
      landed: 'A player asks about the food, the seating or a guest rather than about the job.',
      lever: 'Slow down. Describe one more course. This one cannot be skipped.' },
    { id: 'burns', n: 2, act: 'I', name: 'The room burns',
      when: 'End of loop 1, 8:00',
      landed: 'Somebody says something out loud that is not in character.',
      lever: 'You did it right anyway. Say the reset line and wait.' },
    { id: 'nobody', n: 3, act: 'I', name: 'Nobody else remembers',
      when: 'Loop 2, early',
      landed: 'A player deliberately tests it on an NPC.',
      lever: 'Greet them again with the same handshake and the same sentence, word for word.' },
    { id: 'whole', n: 4, act: 'I', name: 'You come back whole',
      when: 'Loop 2',
      landed: 'A player does something reckless on purpose.',
      lever: 'Let the aspic hurt someone, then say it flat and out of character. This beat is the difference between a cautious session and a good one.' },
    { id: 'allocation', n: 5, act: 'II', name: 'More to do than there is evening',
      when: 'Loop 3',
      landed: 'They start dividing the loop between them unprompted.',
      lever: 'Say the allocation sentence out loud. Most useful thing you will say all night.' },
    { id: 'named', n: 6, act: 'II', name: 'The four faults have names',
      when: 'Loops 3 to 5',
      landed: 'Somebody lists all four without checking.',
      lever: 'Aldeth says the count, or Havel mentions the floor cloths, or the ledger. In that order.' },
    { id: 'havel', n: 7, act: 'II', name: 'Havel remembers',
      when: 'Loops 3 to 6, once',
      landed: 'The table goes quiet, or somebody asks him something in a different tone.',
      lever: 'Do not save it past loop 6. Best card in the deck, and it does nothing in your hand.' },
    { id: 'sticks', n: 8, act: 'II', name: 'Something sticks',
      when: 'When the cold room dies',
      landed: 'You tell them it stuck and somebody reacts.',
      lever: 'Say it out of character. A permanent win the table does not notice is one you wasted.' },
    { id: 'notenough', n: 9, act: 'III', name: 'It works, and it is not enough',
      when: 'The perfect run',
      landed: 'Somebody groans, or laughs, or says no.',
      lever: 'Do not soften it. A version where the toast simply works is a worse evening.' },
    { id: 'choice', n: 10, act: 'III', name: 'The choice',
      when: 'The boss',
      landed: 'They pick, and it feels like a decision rather than a default.',
      lever: 'Pell has been at the table all night. Have him set the case down and go to find the necessary.' }
  ],

  /**
   * Recall Knowledge, and the Dubious Knowledge feat.
   *
   * Dubious Knowledge (Player Core pg. 254) fires on a FAILURE that is not a
   * critical failure: the character gets the correct answer and an erroneous
   * one, with no way to tell them apart.
   *
   * In a looping adventure that stops being a drawback and becomes a resource
   * with a price, because the loop is a machine for testing which answer was
   * true. The cost of finding out is a loop, and loops are the only currency
   * the party actually has.
   *
   * So every lie below is written to three rules:
   *   - it is testable inside a single loop
   *   - being wrong costs a loop and never more than a loop
   *   - it is specific and confidently wrong, never vague
   *
   * Deliver both halves flat, in the same breath, with no tell. The moment you
   * lean on one of them the feat stops working for the rest of the session.
   */
  recallKnowledge: [
    {
      topic: 'The aspic',
      skills: 'Nature or Occultism, DC 28',
      truth: 'Immune to piercing and slashing. Bludgeoning, fire, or spells that are neither are the only things that touch it.',
      lie: 'A heavy line of salt will hold it. Oozes will not cross salt.',
      note: 'Testable in one slot, and a PC solemnly salting the sideboard during the soup course is worth the loop on its own.'
    },
    {
      topic: 'Noble ifrits',
      skills: 'Arcana or Religion, DC 30',
      truth: 'A noble ifrit\u2019s wish-granting subverts the wisher\u2019s intent on purpose. It is bound by the letter and never the spirit.',
      lie: 'An ifrit must answer truthfully any question put to it three times.',
      note: 'They will try it. Qazrahin answers all three times, courteously, and finds the repetition tiresome in a way it is too professional to mention.'
    },
    {
      topic: 'The 4413 vintage',
      skills: 'Lore (Wine) or Mercantile Lore, DC 25',
      truth: 'A bottle that age carries preservation magic. Without it, what is in the decanter cannot be the 4413.',
      lie: 'The 4413 was a famously poor vintage the family has always been quietly embarrassed about.',
      note: 'The dangerous one: believed, it stops them hunting the real bottle. Hestia contradicts it flatly if they reach her.'
    },
    {
      topic: 'Ghosts and Great-Aunt Hestia',
      skills: 'Religion or Occultism, DC 28',
      truth: 'A site-bound ghost rejuvenates. Destroying her resolves nothing and she will remember it.',
      lie: 'A ghost bound by shame is released the instant her secret is spoken aloud to a living person.',
      note: 'Acting on this means announcing Hestia\u2019s secret to her face, which is the one thing that makes her attack. Costs exactly one loop. Worth it.'
    },
    {
      topic: 'The thing in the cold room',
      skills: 'Nature, DC 31',
      truth: 'Piercing or slashing splits it in two, each half at half the hit points. The attack itself does nothing.',
      lie: 'It cannot cross running water.',
      note: 'A party trying to improvise running water inside a walk-in cold room is the comedy this fault was written for.'
    },
    {
      topic: 'The contract',
      skills: 'Legal Lore or Society, DC 28',
      truth: 'A binding of this kind names its occasion precisely, and the named occasion is the whole of its reach.',
      lie: 'Any binding older than three centuries lapses automatically and cannot be enforced.',
      note: 'Believed, they stop looking for clause 3(a) \u2014 which is Route B. The handout refutes it the moment they read it.'
    },
    {
      topic: 'The Vairemont family',
      skills: 'Society or Heraldry Lore, DC 26',
      truth: 'There has not been a Vairemont betrothal in more than three centuries.',
      lie: 'The Vairemonts traditionally seat thirteen at a betrothal, for luck.',
      note: 'The cruellest one. It argues for ADDING a guest when the fault is that there are already twelve. The seating card in their hands says eleven.'
    },
    {
      topic: 'The twelfth guest',
      skills: 'Society, DC 30',
      truth: 'He is not on the seating card, and the card was written before he arrived.',
      lie: 'He is a Pathfinder agent working the room under cover.',
      note: 'Harmless, and Piotr is thrilled to be accused of it. He will not deny it. He has wanted to be interesting his whole life.'
    },
    {
      topic: 'Etiquette and the toast',
      skills: 'Society or Etiquette Lore, DC 26',
      truth: 'The host\u2019s toast closes the betrothal. Once begun, nothing may interrupt it.',
      lie: 'A guest may lawfully interrupt a toast once, to offer a correction, and it is thought charming.',
      note: 'A PC will try this. It is not charming. It is a fresh imperfection, and Qazrahin logs it.'
    },
    {
      topic: 'The fire',
      skills: 'Arcana, DC 30',
      truth: 'The fire is not destroying the room. It is the mechanism of the rewind.',
      lie: 'Anyone outside the dining room at 8:00 is outside the effect and will not be reset.',
      note: 'One loop to disprove, and a good one: they stand in the hall at 7:59, feeling clever, and wake up at 7:51 anyway.'
    },
    {
      topic: 'A genie\u2019s name',
      skills: 'Arcana or Occultism, DC 32',
      truth: 'Qazrahin\u2019s name is simply its name. Knowing it grants nothing.',
      lie: 'Speaking a genie\u2019s true name compels it to serve the speaker for one task.',
      note: 'Qazrahin declines with enormous politeness and a note of regret, as though it wishes the rule were true.'
    },
    {
      topic: 'The orangery',
      skills: 'Arcana, DC 30',
      truth: 'Citrus fruiting out of season marks a persistent effect anchored in that room.',
      lie: 'Destroy the anchor and the effect ends.',
      note: 'Destroying the orangery is loud, expensive, takes most of a loop, and changes nothing. Let them. It is a good scene.'
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
