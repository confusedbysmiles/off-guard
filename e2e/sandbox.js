/**
 * A campaign of a spec's own.
 *
 * Most specs read the fixture and are entitled to assume it looks the way
 * `fixture.js` left it: three characters in the party, one of them with a build
 * and one deliberately without. A spec that writes into that world breaks them,
 * and the breakage lands in whichever file happens to run second -- which is
 * how a suite stops being trusted.
 *
 * So a spec that needs to write makes its own campaign, its own character and
 * its own link, and archives the campaign afterwards. There is no delete for a
 * campaign; archived is enough, because an archived one is out of the switcher
 * and out of the overview.
 *
 * The name matters: campaigns are listed alphabetically and the dashboard opens
 * on the most recently played, so a sandbox is named to sort last and is never
 * played in.
 */
export function sandbox(gmToken, label) {
  const api = (path) => `/api/gm/${gmToken}${path}`;
  const made = {};

  return {
    get campaignId() { return made.campaignId; },
    get playerToken() { return made.playerToken; },
    get characterId() { return made.characterId; },

    async create(request, { characterName = 'Nobody', level = 1 } = {}) {
      const campaign = await (await request.post(api('/campaigns'), {
        data: { name: `Zzz: ${label}`, partyLevel: level },
      })).json();
      made.campaignId = campaign.campaign.id;

      const character = await (await request.post(
        api(`/campaigns/${made.campaignId}/characters`),
        { data: { name: characterName, playerName: 'Nobody' } },
      )).json();
      made.characterId = character.character.id;

      const minted = await (await request.post(
        api(`/campaigns/${made.campaignId}/tokens/character/${made.characterId}`), { data: {} },
      )).json();
      made.playerToken = minted.token.token;
      return made;
    },

    async archive(request) {
      if (!made.campaignId) return;
      await request.post(api(`/campaigns/${made.campaignId}/archive`), {
        data: { archived: true },
      });
    },
  };
}
