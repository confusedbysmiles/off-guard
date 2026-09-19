/**
 * Fetching a Pathbuilder build by id.
 *
 * This is the application's only outbound network call, it happens only when a
 * player asks for it by pasting a build id, and it can be turned off entirely
 * with OFF_GUARD_PATHBUILDER_FETCH=off. It runs on the server rather than in
 * the browser so the page's Content-Security-Policy stays `connect-src 'self'`.
 *
 * A caveat worth knowing before relying on it: pathbuilder2e.com sits behind
 * Cloudflare's bot protection, which answers server-side requests with a
 * challenge page rather than JSON. We do not attempt to defeat that -- the
 * request identifies itself honestly, and when the answer is not JSON the
 * player is told to use Pathbuilder's own JSON export instead, which is the
 * path that always works and needs no network at all.
 */
const ENDPOINT = 'https://pathbuilder2e.com/json.php';
const TIMEOUT_MS = 10_000;

export const USER_AGENT = 'Off-Guard (self-hosted Pathfinder 2e table tool)';

export function fetchEnabled(env = process.env) {
  return String(env.OFF_GUARD_PATHBUILDER_FETCH ?? 'on').toLowerCase() !== 'off';
}

/**
 * A failure the player is meant to read.
 *
 * `expose` is the point. The error handler replaces the body of anything 500
 * or over with "Something went wrong", which is right for a stack trace and
 * exactly wrong here: every message this class carries is a remedy -- what a
 * build id looks like, or to use the export file instead -- and swallowing
 * them left the dialog saying "Something went wrong" over a typo. The status
 * still says whose fault it was; `expose` says the wording is safe to show.
 */
export class PathbuilderFetchError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = 'PathbuilderFetchError';
    this.statusCode = statusCode;
    this.expose = true;
  }
}

/**
 * The id out of whatever was pasted.
 *
 * A bare number is the documented thing to type, and the whole link is what
 * people actually have in hand. Refusing the link on the grounds that it is
 * not a number is technically correct and useless.
 */
export function buildIdFrom(value) {
  const text = String(value ?? '').trim();
  if (/^\d{1,12}$/.test(text)) return text;
  const fromUrl = text.match(/[?&]id=(\d{1,12})\b/);
  return fromUrl ? fromUrl[1] : null;
}

export async function fetchBuild(buildId, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (!fetchEnabled(env)) {
    throw new PathbuilderFetchError(
      'Fetching by build id is switched off on this server. Use Pathbuilder’s JSON export file instead.',
    );
  }

  const id = buildIdFrom(buildId);
  if (!id) {
    // 400, not 502: a typo is not Pathbuilder failing.
    throw new PathbuilderFetchError(
      'A Pathbuilder build id is the number from its export screen — or paste the whole link.',
      400,
    );
  }

  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(`${ENDPOINT}?id=${id}`, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal,
    });
  } catch (error) {
    throw new PathbuilderFetchError(
      `Could not reach Pathbuilder (${error.message}). Use its JSON export file instead.`,
    );
  }

  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* handled below */ }

  if (!parsed) {
    // Almost always the Cloudflare interstitial. Say what it is and what works.
    throw new PathbuilderFetchError(
      'Pathbuilder answered with a bot check rather than the build. '
      + 'In Pathbuilder, use Export → JSON and upload the file here instead.',
    );
  }

  if (parsed.success === false) {
    throw new PathbuilderFetchError(`Pathbuilder has no build with id ${id}.`);
  }

  return parsed;
}
