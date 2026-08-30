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
import { displayName } from '../../../engine/shared/character-name.js';
import { debounce } from '../lib/dom.js';
import { blankState, resetLoop, setInfluence } from '../../../engine/shared/loop.js';
import { assignDisplayNames } from './views/builder.js';

/** A revealed fact was stored as a bare key by an earlier build; accept both. */
const keyOf = (fact) => (typeof fact === 'string' ? fact : fact.key);

export function createActions({
  api, store, notices, refresh, showStatBlock, showPrompts, showLink,
}) {
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

    /** The order encounters are planned in, which is the order a session runs. */
    async reorderEncounters(order) {
      try {
        const { encounters } = await api.reorderEncounters(campaign(), order);
        store.set({ encounters });
        refresh();
      } catch (error) {
        notices.error(`Could not reorder: ${error.message}`);
      }
    },

    /**
     * The order creatures sit in within one encounter.
     *
     * No endpoint of its own: the whole creature list is saved on every edit
     * anyway, so a reorder is that same save with the array in a new order.
     */
    reorderRows(order) {
      updateRows((rows) => order.map((index) => rows[index]).filter(Boolean));
    },

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
        adventure: encounter.adventure,
        chapter: encounter.chapter,
        sortOrder: encounter.sortOrder,
        notes: encounter.notes,
        terrain: encounter.terrain,
        lighting: encounter.lighting,
        treasure: encounter.treasure,
        // A one-shot prices itself against its own party, not the campaign's
        // sheets. Without these the budget silently re-reads the party panel.
        partyLevelOverride: encounter.partyLevelOverride,
        partySizeOverride: encounter.partySizeOverride,
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
          adventure: parsed.adventure ?? null,
          chapter: parsed.chapter ?? null,
          sortOrder: parsed.sortOrder ?? 0,
          notes: parsed.notes ?? '',
          terrain: parsed.terrain ?? '',
          lighting: parsed.lighting ?? '',
          treasure: parsed.treasure ?? '',
          partyLevelOverride: parsed.partyLevelOverride ?? null,
          partySizeOverride: parsed.partySizeOverride ?? null,
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

    // --- the loop console ----------------------------------------------------

    /**
     * Load a looping adventure for the current campaign.
     *
     * A campaign that has never run it gets the adventure's blank state rather
     * than an error: opening the console for the first time is the normal case,
     * and there is nothing to report about it.
     */
    async loadLoop(adventure) {
      const id = campaign();
      if (!id || !adventure) return;
      // Set before awaiting. The tab renders immediately and the GM can click
      // while the fetch is in flight; an action that found no adventure in the
      // store would do nothing at all, which reads as a dead interface.
      store.set({ loopAdventure: adventure, loopRun: null, loopState: blankState(adventure) });
      try {
        const { run } = await api.loopRun(id, adventure.id);
        store.set({ loopRun: run, loopState: run?.state ?? blankState(adventure) });
      } catch (error) {
        // The blank state set above stands, which keeps the console usable when
        // the fetch fails. Saving will retry on the next edit.
        notices.error(`Could not load the loop console: ${error.message}`);
      }
      refresh();
    },

    /**
     * Write the state the GM is looking at.
     *
     * Debounced, because a slot note is typed a character at a time and the
     * whole state is small enough that sending it whole is cheaper than working
     * out what changed.
     */
    saveLoop: debounce(async () => {
      const id = campaign();
      const { loopAdventure, loopState } = store.get();
      if (!id || !loopAdventure || !loopState) return;
      try {
        const { run } = await api.saveLoopRun(id, loopAdventure.id, {
          state: loopState, title: loopAdventure.title,
        });
        store.set({ loopRun: run });
      } catch (error) {
        notices.error(`The loop console did not save: ${error.message}`);
      }
    }, 400),

    /** Apply a change to the loop state and persist it. */
    patchLoop(next) {
      store.set({ loopState: next });
      actions.saveLoop();
      refresh();
    },

    loopSlot(slot) {
      const { loopAdventure, loopState } = store.get();
      if (!loopAdventure) return;
      const clamped = Math.min(loopAdventure.loop.slots, Math.max(1, slot));
      if (clamped === loopState.slot) return;
      actions.patchLoop({ ...loopState, slot: clamped });
    },

    /**
     * Burn the room.
     *
     * The one destructive thing the console does, so it offers an undo the way
     * deleting a session note does. The state before the reset is still in hand.
     */
    loopReset() {
      const { loopState } = store.get();
      const before = loopState;
      actions.patchLoop(resetLoop(loopState));
      notices.warn(`Loop ${before.loop} burned.`, {
        detail: 'Fixes cleared. What the party knows, and anything solved permanently, carried over.',
        actions: [['Undo', () => actions.patchLoop(before)]],
        timeout: 8000,
      });
    },

    /** `known` and `fixed` on one fault. Fixing something implies knowing it. */
    loopFault(faultId, patch) {
      const { loopState } = store.get();
      const current = loopState.faults[faultId] ?? { known: false, fixed: false, sticky: false };
      const next = { ...current, ...patch };
      if (next.fixed) next.known = true;
      actions.patchLoop({ ...loopState, faults: { ...loopState.faults, [faultId]: next } });
    },

    /**
     * Mark a fault solved by removing its cause rather than its symptom.
     *
     * The only progress in a looping adventure that survives a reset, so it
     * says so out loud -- a table that does not notice this landed has been
     * robbed of the one win the loop cannot take back.
     */
    loopSticky(faultId, sticky) {
      const { loopState } = store.get();
      const current = loopState.faults[faultId] ?? { known: false, fixed: false, sticky: false };
      const next = sticky
        ? { known: true, fixed: true, sticky: true }
        : { ...current, sticky: false };
      actions.patchLoop({ ...loopState, faults: { ...loopState.faults, [faultId]: next } });
      if (sticky) notices.info('That one stays fixed through every reset from here.');
    },

    loopInfluence(points) {
      const { loopAdventure, loopState } = store.get();
      if (!loopAdventure) return;
      actions.patchLoop(setInfluence(loopState, points, loopAdventure.influence.max));
    },

    loopDiscovery(name) {
      const { loopState } = store.get();
      const held = new Set(loopState.influence.discovered);
      if (held.has(name)) held.delete(name); else held.add(name);
      actions.patchLoop({
        ...loopState,
        influence: { ...loopState.influence, discovered: [...held] },
      });
    },

    loopParty(index, name) {
      const { loopState } = store.get();
      const party = [...loopState.party];
      party[index] = name;
      actions.patchLoop({ ...loopState, party });
    },

    loopNote(actorIndex, slot, text) {
      const { loopState } = store.get();
      const loop = String(loopState.loop);
      const log = { ...loopState.log };
      log[loop] = { ...(log[loop] ?? {}) };
      log[loop][actorIndex] = { ...(log[loop][actorIndex] ?? {}), [slot]: text };
      actions.patchLoop({ ...loopState, log });
    },

    // --- initiative --------------------------------------------------------

    /**
     * Roll initiative.
     *
     * Starting a fight ends whatever was running, in one statement on the
     * server, and that cannot be undone -- so a second one is asked about
     * rather than done. The question lives here rather than at the button
     * because there are two buttons: the Initiative tab and the encounter
     * builder.
     *
     * `onStarted` runs once a fight is actually running, and is carried through
     * the confirmation rather than left to the caller: the encounter builder
     * moves the GM to the Initiative tab, and it has to do that whether the
     * fight started on the first click or after the question.
     */
    async startCombat({
      encounterId = null, skill = 'perception', replacing = false, onStarted = null,
    } = {}) {
      if (!replacing && store.get().combat) {
        notices.warn('A fight is already running.', {
          detail: 'Rolling initiative again ends it and starts a new one, '
            + 'and that cannot be undone.',
          actions: [['End it and roll', () => actions.startCombat({
            encounterId, skill, replacing: true, onStarted,
          })]],
        });
        return false;
      }
      try {
        const { combat } = await api.startCombat(campaign(), { encounterId });
        const { combat: filled } = await api.populate(campaign(), combat.id, {
          encounterId, skill, includeParty: true,
        });
        store.set({ combat: filled });
        refresh();
        notices.info('Initiative rolled for the creatures. Players roll their own.');
        if (onStarted) onStarted();
        return true;
      } catch (error) {
        notices.error(`Could not start the fight: ${error.message}`);
        return false;
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

    // --- links --------------------------------------------------------------

    async loadTokens() {
      if (!campaign()) return;
      try {
        store.set({ tokens: (await api.tokens(campaign())).tokens });
      } catch (error) {
        notices.error(`Could not load the links: ${error.message}`);
      }
    },

    /**
     * Each of these ends by showing the new link once. `showLink` is the
     * dashboard's dialog; nothing here keeps the value, and the next call to
     * `loadTokens` cannot get it back.
     */
    async mintTableLink() {
      try {
        const { token } = await api.mintTableToken(campaign());
        await actions.loadTokens();
        refresh();
        showLink('table', token.token, 'the shared screen');
      } catch (error) {
        notices.error(`Could not make that link: ${error.message}`);
      }
    },

    async mintCharacterLink(characterId, name) {
      try {
        const { token } = await api.mintCharacterToken(campaign(), characterId);
        await actions.loadTokens();
        refresh();
        showLink('character', token.token, name);
      } catch (error) {
        notices.error(`Could not make that link: ${error.message}`);
      }
    },

    async rotateLink(tokenId, subject) {
      try {
        const { token } = await api.rotateToken(tokenId);
        await actions.loadTokens();
        refresh();
        showLink(token.kind, token.token, subject);
      } catch (error) {
        notices.error(`Could not rotate that link: ${error.message}`);
      }
    },

    /**
     * The GM's own link.
     *
     * Rotating it invalidates the token this page is running on, so the new one
     * is shown before anything else happens and the dashboard stops making
     * requests it can only fail. Confirmed first, because it is the one action
     * here that cannot be undone by pressing the same button again.
     */
    async rotateGmLink() {
      try {
        // The GM token belongs to no campaign, so it is not in any campaign's
        // listing; ask the server which token this request arrived on.
        const me = await api.me();
        const { token } = await api.rotateToken(me.tokenId);
        showLink('gm', token.token, 'you', { final: true });
      } catch (error) {
        notices.error(`Could not rotate your link: ${error.message}`);
      }
    },

    // --- the campaign itself, its roster and its log --------------------------

    async loadSessions() {
      if (!campaign()) return;
      try {
        store.set({ sessions: (await api.sessions(campaign())).sessions });
      } catch (error) {
        notices.error(`Could not load the session log: ${error.message}`);
      }
    },

    /**
     * Save a change to the campaign.
     *
     * The switcher, the accents and the overview all read from the same list,
     * so the saved row is written back into it rather than refetched -- an
     * accent colour that only appears after a reload is worse than none.
     */
    async saveCampaign(fields) {
      const id = campaign();
      if (!id) return;
      try {
        const { campaign: saved } = await api.updateCampaign(id, fields);
        store.set({
          campaigns: store.get().campaigns.map((c) => (c.id === id ? saved : c)),
        });
        refresh();
      } catch (error) {
        notices.error(`Could not save: ${error.message}`);
      }
    },

    async archiveCampaign(archived) {
      const id = campaign();
      if (!id) return;
      try {
        const { campaign: saved } = await api.archiveCampaign(id, archived);
        store.set({
          campaigns: store.get().campaigns.map((c) => (c.id === id ? saved : c)),
        });
        refresh();
        notices.info(archived ? 'Archived. Nothing was deleted.' : 'Unarchived.', {
          actions: [[archived ? 'Undo' : 'Re-archive', () => actions.archiveCampaign(!archived)]],
        });
      } catch (error) {
        notices.error(`Could not archive: ${error.message}`);
      }
    },

    /**
     * Remove a character.
     *
     * Undo rather than a confirmation dialog, which is how everything else here
     * deletes: a dialog interrupts a GM mid-sentence, and the row is in memory
     * anyway. The one thing undo cannot bring back is the link — tokens are
     * stored hashed, so a restored character needs a new one, and the notice
     * says so rather than letting a player find out.
     */
    async removeCharacter(character) {
      const campaignId = campaign();
      if (!campaignId) return;
      try {
        const result = await api.deleteCharacter(campaignId, character.id);
        await Promise.all([actions.loadParty(), actions.loadTokens()]);
        refresh();

        const had = result.revokedLinks > 0;
        notices.warn(`Removed ${displayName(result.character)}.`, {
          detail: had
            ? 'Their link no longer works. Undo brings the sheet back, but not '
              + 'the link — that has to be made again.'
            : 'They had no link yet.',
          actions: [['Undo', async () => {
            const { character: restored } = await api.createCharacter(campaignId, {
              name: result.character.name,
              playerName: result.character.playerName,
              level: result.character.level,
              sheet: result.character.sheet,
            });
            await Promise.all([actions.loadParty(), actions.loadTokens()]);
            refresh();
            if (had) {
              notices.info(
                `${displayName(restored)} is back. Make them a new link below.`,
              );
            }
          }]],
        });
      } catch (error) {
        notices.error(`Could not remove that character: ${error.message}`);
      }
    },

    async addCharacter(fields) {
      const id = campaign();
      if (!id) return;
      try {
        await api.createCharacter(id, fields);
        await Promise.all([actions.loadParty(), actions.loadTokens()]);
        refresh();
        notices.info(
          `Added ${displayName(fields)}. Make their link below when you are ready.`,
        );
      } catch (error) {
        notices.error(`Could not add that character: ${error.message}`);
      }
    },

    async addSession(fields) {
      const id = campaign();
      if (!id) return;
      try {
        const { session } = await api.createSession(id, fields);
        store.set({ sessions: [session, ...store.get().sessions] });
        // Writing up a session marks the campaign as played, which is what the
        // overview and the opening campaign are chosen by.
        await actions.loadOverview();
        refresh();
      } catch (error) {
        notices.error(`Could not save that session: ${error.message}`);
      }
    },

    async removeSession(session) {
      const id = campaign();
      try {
        await api.deleteSession(id, session.id);
        store.set({ sessions: store.get().sessions.filter((s) => s.id !== session.id) });
        refresh();
        // Undo rather than a confirmation: the whole row is still in hand, and
        // a dialog to delete a note is more interruption than the note is worth.
        notices.warn(`Deleted “${session.title || 'that session'}”.`, {
          actions: [['Undo', async () => {
            await api.createSession(id, {
              title: session.title, body: session.body, playedAt: session.playedAt,
            });
            await actions.loadSessions();
            refresh();
          }]],
        });
      } catch (error) {
        notices.error(`Could not delete that: ${error.message}`);
      }
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
