/**
 * Where this application is mounted, and which link opened it.
 *
 * Off-Guard can be served from the root of a host or from a subdirectory of
 * one -- `drseim.com/off-guard` -- and the browser has to build API URLs that
 * work in either case. Nothing configures this: the page works it out from its
 * own address.
 *
 * That is possible because every page has exactly the same shape:
 *
 *     <mount>/gm/<token>
 *     <mount>/c/<token>
 *     <mount>/table/<token>
 *
 * Two segments, always. So the mount is the path with those two removed, and
 * the kind and the token are the two that were removed. Stylesheets and module
 * imports do the same thing with `../`, which is why none of them are
 * root-absolute any more.
 *
 * The token stays here and in `location`. It is never written into the
 * document, a title, a meta tag or a data attribute.
 */

const segments = location.pathname.replace(/\/+$/, '').split('/');

/** `'gm'`, `'c'` or `'table'` -- which link this page was opened with. */
export const kind = segments.at(-2) ?? '';

/** The token from the path. */
export const token = segments.at(-1) ?? '';

/**
 * The mount point, with no trailing slash: `''` at a host root,
 * `'/off-guard'` in a subdirectory.
 */
export const mount = segments.slice(0, -2).join('/');

/** `apiPath('/api/gm/ABC')` -> `/off-guard/api/gm/ABC`. */
export const apiPath = (path) => `${mount}${path}`;
