/**
 * Everything the dashboard does.
 *
 * Split out of `main.js`, which had grown to do routing, keyboard handling,
 * notices and every action at once. The actions are the part that changes most
 * often, and they are the part worth reading on their own.
 *
 * Every one of them is a closure over the same four things: the API, the store,
 * the notice region and a `refresh` callback. Nothing here touches the DOM.
 */
import { debounce } from '../lib/dom.js';
import { assignDisplayNames } from './views/builder.js';

/** A revealed fact was stored as a bare key by an earlier build; accept both. */
const keyOf = (fact) => (typeof fact === 'string' ? fact : fact.key);

export function createActions({ api, store, notices, refresh, showStatBlock, showPrompts }) {
  /** Names for creatures on screen, so display names can be generated. */
  const creatureNames = new Map();

  let searchQuery = {
    q: '', levelMin: null, levelMax: null, traits: [], rarity: null, size: null, source: null,
  };

  const campaign = () => store.get().campaignId;

  async function loadParty() {
    if (!campaign()) return;
    try {
      store.set({ party: await api.party(campaign()) });
    } catch (error) {
      notices.error(`Could not load the party: ${error.message}`);
    }
  }

  async function loadEncounters() {
    if (!campaign()) return;
    try {
      store.set({ encounters: (await api.encounters(campaign())).encounters });
    } catch (error) {
      notices.error(`Could not load encounters: ${error.message}`);
    }
  }

  async function loadCombat() {
    if (!campaign()) return;
    try {
      store.set({ combat: (await api.combat(campaign())).combat });
    } catch (error) {
      notices.error(`Could not load the fight: ${error.message}`);
    }
  }

  async function loadOverview() {
    try {
      store.set({ overview: (await api.overview()).campaigns });
    } catch (error) {
      notices.error(`Could not load the overview: ${error.message}`);
    }
  }

  async function loadBudget() {
    const { encounter } = store.get();
    if (!campaign() || !encounter) return;
    try {
      store.set({ budget: await api.budget(campaign(), encounter.id) });
    } catch (error) {
      notices.error(`Could not price the encounter: ${error.message}`);
    }
  }

  const saveRows = debounce(async (rows) => {
    const { encounter } = store.get();
    if (!encounter) return;
    try {
      const saved = await api.setCreatures(campaign(), encounter.id, rows);
      store.set({ encounter: saved.encounter });
      await loadBudget();
      refresh();
    } catch (error) {
      notices.error(`Could not save the encounter: ${error.message}`);
    }
  }, 300);

  function updateRows(mutate) {
    const { encounter } = store.get();
    if (!encounter) return;
    const next = assignDisplayNames(mutate([...encounter.creatures]), (id) => creatureNames.get(id));
    store.set({ encounter: { ...encounter, creatures: next } });
    refresh();
    saveRows(next);
  }

  const actions = {
    creatureNames,
    get searchQuery() { return searchQuery; },

    /** The dialog, so a view can open a stat block it already has in hand. */
    showStatBlock,

    loadParty, loadEncounters, loadCombat, loadOverview, loadBudget,

    // --- searching and previewing -----------------------------------------

    async search(query) {
      searchQuery = query;
      try {
        const results = await api.search({ ...query, limit: 60 });
        for (const row of results.rows) creatureNames.set(row.id, row.name);
        store.set({ searchResults: results });
      } catch (error) {
        store.set({ searchResults: { available: true, total: 0, rows: [] } });
        notices.error(`Search failed: ${error.message}`);
      }
      refresh();
    },

    async preview(id, params = {}) {
      try {
        const { creature } = await api.creature(id, params);
        showStatBlock(creature);
      } catch (error) {
        notices.error(`Could not load that stat block: ${error.message}`);
      }
    },

    // --- the encounter -----------------------------------------------------

    add(creatureId, count) {
      if (!store.get().encounter) {
        notices.warn('Start an encounter first.', {
          actions: [['New encounter', () => actions.newEncounter()]],
        });
        return;
      }
      updateRows((rows) => {
        const existing = rows.findIndex((r) => r.creatureId === creatureId
          && !r.adjustment && !r.levelScale && !r.renamed);
        if (existing !== -1) {
          rows[existing] = { ...rows[existing], count: (rows[existing].count ?? 1) + count };
          return rows;
        }
        return [...rows, { creatureId, count, adjustment: null, levelScale: 0, displayName: '' }];
      });
    },

    updateRow(index, patch) {
      updateRows((rows) => { rows[index] = { ...rows[index], ...patch }; return rows; });
    },

    removeRow(index) {
      updateRows((rows) => { rows.splice(index, 1); return rows; });
    },

    async newEncounter() {
      try {
        const { encounter } = await api.createEncounter(campaign(), { name: 'New encounter' });
        await loadEncounters();
        store.set({ encounter, encounterId: encounter.id, budget: null });
        refresh();
      } catch (error) {
        notices.error(`Could not create an encounter: ${error.message}`);
      }
    },

    async openEncounter(id) {
      if (!id) {
        store.set({ encounter: null, encounterId: null, budget: null });
        refresh();
        return;
      }
      try {
        const { encounter } = await api.encounter(campaign(), id);
        for (const row of encounter.creatures) {
          if (!creatureNames.has(row.creatureId)) {
            creatureNames.set(row.creatureId, row.displayName?.replace(/ [A-Z]$/, '') || row.creatureId);
          }
        }
        store.set({ encounter, encounterId: id });
        store.writeLocation({ campaignId: campaign(), tab: 'encounters', encounterId: id });
        await loadBudget();
        refresh();
      } catch (error) {
        notices.error(`Could not open that encounter: ${error.message}`);
      }
    },

    renameEncounter: (name) => actions.updateEncounter({ name }),

    async updateEncounter(fields) {
      const { encounter } = store.get();
      if (!encounter) return;
      try {
        const { encounter: saved } = await api.updateEncounter(campaign(), encounter.id, fields);
        store.set({ encounter: { ...saved, creatures: encounter.creatures } });
        await loadEncounters();
        refresh();
      } catch (error) {
        notices.error(`Could not save: ${error.message}`);
      }
    },

    async deleteEncounter() {
      const { encounter } = store.get();
      if (!encounter) return;
      const removed = { ...encounter };
      const campaignId = campaign();
      try {
        await api.deleteEncounter(campaignId, encounter.id);
        store.set({ encounter: null, encounterId: null, budget: null });
        await loadEncounters();
        refresh();
        // Undo rather than a confirmation dialog: a dialog interrupts a GM
        // mid-sentence, and the rows are still in memory anyway.
        notices.warn(`Deleted “${removed.name}”.`, {
          actions: [['Undo', async () => {
            const { encounter: restored } = await api.createEncounter(campaignId, removed);
            if (removed.creatures.length) {
              await api.setCreatures(campaignId, restored.id, removed.creatures);
            }
            await loadEncounters();
            await actions.openEncounter(restored.id);
          }]],
        });
      } catch (error) {
        notices.error(`Could not delete: ${error.message}`);
      }
    },

    async copyEncounter(toCampaignId) {
      const { encounter } = store.get();
      try {
        const preview = await api.reprice(campaign(), encounter.id, toCampaignId);
        await api.copyEncounter(campaign(), encounter.id, toCampaignId);
        await loadEncounters();
        if (preview.bandChanged) {
          notices.warn(
            `Copied to ${preview.toCampaign.name}, and the difficulty moved.`,
            {
              detail: `${preview.before.difficulty ?? 'unrated'} for ${preview.fromCampaign.name}, `
                + `${preview.after.difficulty ?? 'unrated'} for ${preview.toCampaign.name}.`,
            },
          );
        } else {
          notices.info(`Copied to ${preview.toCampaign.name}. Difficulty is unchanged.`);
        }
      } catch (error) {
        notices.error(`Could not copy: ${error.message}`);
      }
    },

    exportEncounter() {
      const { encounter } = store.get();
      if (!encounter) return;
      const payload = {
        offGuardEncounter: 1,
        name: encounter.name,
        notes: encounter.notes,
        terrain: encounter.terrain,
        lighting: encounter.lighting,
        treasure: encounter.treasure,
        creatures: encounter.creatures.map((row) => ({
          creatureId: row.creatureId,
          displayName: row.displayName,
          adjustment: row.adjustment,
          levelScale: row.levelScale,
          count: row.count,
        })),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${encounter.name.replace(/[^\w -]/g, '') || 'encounter'}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },

    /** Import an encounter from a file. Creatures the catalogue lacks are reported. */
    async importEncounter(file) {
      try {
        const parsed = JSON.parse(await file.text());
        if (!Array.isArray(parsed.creatures)) throw new Error('no creature list');
        const { encounter } = await api.createEncounter(campaign(), {
          name: parsed.name ?? 'Imported encounter',
          notes: parsed.notes ?? '',
          terrain: parsed.terrain ?? '',
          lighting: parsed.lighting ?? '',
          treasure: parsed.treasure ?? '',
        });
        await api.setCreatures(campaign(), encounter.id, parsed.creatures);
        await loadEncounters();
        await actions.openEncounter(encounter.id);
        const missing = store.get().budget?.missing ?? [];
        if (missing.length) {
          notices.warn(`${missing.length} creature(s) in that file are not in this catalogue.`, {
            detail: missing.map((m) => m.creatureId).join(', '),
          });
        } else {
          notices.info(`Imported “${encounter.name}”.`);
        }
      } catch (error) {
        notices.error(`That file could not be imported: ${error.message}`);
      }
    },

    // --- initiative --------------------------------------------------------

    async startCombat({ encounterId = null, skill = 'perception' } = {}) {
      try {
        const { combat } = await api.startCombat(campaign(), { encounterId });
        const { combat: filled } = await api.populate(campaign(), combat.id, {
          encounterId, skill, includeParty: true,
        });
        store.set({ combat: filled });
        refresh();
        notices.info('Initiative rolled for the creatures. Players roll their own.');
      } catch (error) {
        notices.error(`Could not start the fight: ${error.message}`);
      }
    },

    async updateCombatant(id, fields) {
      try {
        const { combatant } = await api.updateCombatant(campaign(), id, fields);
        const { combat } = store.get();
        store.set({
          combat: {
            ...combat,
            combatants: combat.combatants.map((c) => (c.id === id ? combatant : c)),
          },
        });
        refresh();
      } catch (error) {
        notices.error(`Could not update: ${error.message}`);
      }
    },

    async damage(id, amount) {
      try {
        const result = await api.damage(campaign(), id, amount);
        await loadCombat();
        refresh();
        if (result.notes.length) {
          notices[result.dead ? 'error' : 'warn'](
            `${result.combatant.displayName}: ${result.notes[0]}`,
            { detail: result.notes.slice(1).join(' ') || null },
          );
        }
      } catch (error) {
        notices.error(`Could not apply that: ${error.message}`);
      }
    },

    async removeCombatant(id) {
      try {
        await api.removeCombatant(campaign(), id);
        await loadCombat();
        refresh();
      } catch (error) {
        notices.error(`Could not remove: ${error.message}`);
      }
    },

    async sortInitiative() {
      const { combat } = store.get();
      if (!combat) return;
      const { combat: sorted } = await api.sortInitiative(campaign(), combat.id);
      store.set({ combat: sorted });
      refresh();
    },

    async reorder(order) {
      const { combat } = store.get();
      if (!combat) return;
      const { combat: reordered } = await api.orderCombatants(campaign(), combat.id, order);
      store.set({ combat: reordered });
      refresh();
    },

    async advance(direction = 1) {
      const { combat } = store.get();
      if (!combat) return;
      try {
        const result = await api.advance(campaign(), combat.id, direction);
        store.set({ combat: result.combat });
        refresh();
        if (result.prompts.length) showPrompts(result.prompts);
      } catch (error) {
        notices.error(`Could not advance the turn: ${error.message}`);
      }
    },

    async endCombat() {
      const { combat } = store.get();
      if (!combat) return;
      await api.endCombat(campaign(), combat.id);
      store.set({ combat: null });
      refresh();
      notices.info('Fight ended.');
    },

    // --- the drawer: reference, dice and Recall Knowledge -------------------

    /** The corpus. Fetched once; the drawer caches the index it builds. */
    loadReference: () => api.reference(),

    async loadRolls() {
      if (!campaign()) return;
      try {
        store.set({ rolls: (await api.rolls(campaign())).rolls });
      } catch (error) {
        notices.error(`Could not load the dice log: ${error.message}`);
      }
    },

    async roll({ expression, label, secret }) {
      try {
        const { roll } = await api.roll(campaign(), { expression, label, secret });
        store.set({ rolls: [roll, ...store.get().rolls] });
        return roll;
      } catch (error) {
        notices.error(error.message);
        return null;
      }
    },

    async deriveRoll(rollId, derivation) {
      try {
        const { roll } = await api.deriveRoll(campaign(), rollId, derivation);
        store.set({ rolls: [roll, ...store.get().rolls] });
      } catch (error) {
        notices.error(`Could not ${derivation} that: ${error.message}`);
      }
    },

    async clearRolls() {
      const previous = store.get().rolls;
      try {
        await api.clearRolls(campaign());
        store.set({ rolls: [] });
        notices.info(`Cleared ${previous.length} roll(s).`);
      } catch (error) {
        notices.error(`Could not clear the log: ${error.message}`);
      }
    },

    /**
     * Recall Knowledge against a combatant.
     *
     * `subject` is the sentence shown above the panel -- who is being asked
     * about -- and is kept on the state so re-rendering the drawer after a
     * reveal does not lose it.
     */
    async openRecall(combatantId, subject = null) {
      try {
        const recall = await api.recallCombatant(campaign(), combatantId);
        store.set({ recall: { ...recall, subject, difficulty: null } });
      } catch (error) {
        store.set({ recall: null });
        notices.error(`Could not work that out: ${error.message}`);
      }
    },

    async reloadRecall(difficulty) {
      const { recall } = store.get();
      if (!recall) return;
      try {
        const next = await api.recallCombatant(campaign(), recall.combatantId, { difficulty });
        store.set({ recall: { ...next, subject: recall.subject, difficulty } });
      } catch (error) {
        notices.error(`Could not adjust the DC: ${error.message}`);
      }
    },

    /**
     * Show or hide one fact on the shared screen.
     *
     * The whole fact is stored, not just its key: the screen has to render the
     * label and the value, and it has no stat block to look them up in.
     */
    async revealFact(fact, revealed) {
      const { recall, combat } = store.get();
      if (!recall) return;
      const current = combat?.combatants.find((c) => c.id === recall.combatantId)?.revealed ?? [];
      const next = revealed
        ? [...current.filter((f) => keyOf(f) !== fact.key),
          { key: fact.key, label: fact.label, value: fact.value }]
        : current.filter((f) => keyOf(f) !== fact.key);
      await actions.updateCombatant(recall.combatantId, { revealed: next });
      await actions.reloadRecall(recall.difficulty ?? null);
    },

    async revealAllFacts(revealed) {
      const { recall } = store.get();
      if (!recall) return;
      const next = revealed
        ? recall.facts.map((f) => ({ key: f.key, label: f.label, value: f.value }))
        : [];
      await actions.updateCombatant(recall.combatantId, { revealed: next });
      await actions.reloadRecall(recall.difficulty ?? null);
    },

    // --- campaigns ----------------------------------------------------------

    async newCampaign(name) {
      if (!name) return;
      try {
        const { campaign: created } = await api.createCampaign({ name });
        store.set({ campaigns: [...store.get().campaigns, created] });
        await loadOverview();
        return created;
      } catch (error) {
        notices.error(`Could not create the campaign: ${error.message}`);
        return null;
      }
    },
  };

  return actions;
}
