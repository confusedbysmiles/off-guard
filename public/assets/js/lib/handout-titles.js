/**
 * Showing a list of handouts whose names all start the same way.
 *
 * A campaign's handouts tend to come out of one folder and be named for it:
 *
 *   The Hall of Regrettable Artifacts - Schedule of Leases in Force - Extract 1.pdf
 *   The Hall of Regrettable Artifacts - Conditions of Custody.pdf
 *   The Hall of Regrettable Artifacts - Night 3 Post.pdf
 *
 * Every row opens with the same thirty-six characters and the part that tells
 * them apart is at the end, after a long identical run. That is a list you
 * read by scanning for the tail of a wrapped line, which is a poor way to find
 * the right checkbox with a table waiting.
 *
 * So the shared opening is found and shown once, and each row keeps only what
 * distinguishes it. Nothing is renamed: this is presentation, and the stored
 * title is what a download is still called.
 */

/** Separators a sensible prefix may end on. Cutting mid-word helps nobody. */
const BREAK = /[\s\-–—:_|/]/;

/**
 * A leading article is ignored when comparing.
 *
 * Seven of these files begin "The Hall of Regrettable Artifacts" and the
 * eighth begins "Hall of Regrettable Artifacts", so a strict common prefix
 * across all of them is the empty string and the whole exercise fails on a
 * word nobody reads. Real folders are untidy in exactly this way.
 */
const ARTICLE = /^(the|a|an)\s+/i;

const stripExtension = (title) => String(title).replace(/\.(pdf|png|jpe?g|webp|txt|md)$/i, '');

/** The longest opening every title shares, cut back to a word boundary. */
function sharedPrefix(titles) {
  if (titles.length < 2) return '';
  let end = 0;
  const first = titles[0];
  while (end < first.length && titles.every((t) => t[end] === first[end])) end += 1;
  // Back off to the last separator, so "Extract 1"/"Extract 3" does not become
  // "1"/"3" and lose the word they have in common for no reason.
  while (end > 0 && !BREAK.test(first[end - 1])) end -= 1;
  const trimmed = first.slice(0, end).replace(/[\s\-–—:_|/]+$/, '');
  if (trimmed.length < 8) return '';
  // Nothing may be reduced to nothing.
  if (titles.some((t) => !t.slice(trimmed.length).replace(/^[\s\-–—:_|/]+/, '').trim())) return '';
  return trimmed;
}

/**
 * @param {Array<{id: *, title: string}>} handouts
 * @returns {{ shared: string, short: Map }}  `short` maps id to what to show.
 */
export function displayTitles(handouts) {
  const rows = (handouts ?? []).map((h) => {
    const title = stripExtension(h.title);
    return { id: h.id, title, compare: title.replace(ARTICLE, '') };
  });

  const shared = sharedPrefix(rows.map((r) => r.compare));
  const short = new Map(rows.map((r) => [
    r.id,
    shared
      ? (r.compare.slice(shared.length).replace(/^[\s\-–—:_|/]+/, '') || r.title)
      : r.title,
  ]));
  return { shared, short };
}
