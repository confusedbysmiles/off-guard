# Licensing of bundled game data

Off-Guard bundles creature, hazard and reference data extracted from the
[foundryvtt/pf2e](https://github.com/foundryvtt/pf2e) system at the commit pinned
in `tools/build-data/upstream.lock.json`. That data is **not uniformly licensed**:
it is split between two licences, and every record in `data/` carries its own
`source.license` so the app can render the correct notice per entry.

| Licence | Records | Typical source |
| --- | --- | --- |
| ORC  | 3,448 | Monster Core, Monster Core 2, NPC Core, GM Core, remastered adventures |
| OGL 1.0a | 4,165 | Pathfinder Bestiary 1–3 and other pre-remaster material |

Both licence texts must therefore be carried, and the footer notice must reflect
whichever licence covers the entry on screen — not a single blanket statement.

## Files here

- `OGL-1.0a.txt` — the Open Game License 1.0a, in full, with the Section 15
  copyright-notice chain.
- `ORC-License.txt` — **incomplete, see the file.** The ORC License text is not
  distributed in the upstream repository and must be pasted in from the official
  source before this project is shown to anyone but its author.
- `ATTRIBUTION.md` — upstream attribution and the Paizo compatibility statement.

## Software licence

The upstream repository's own code is Apache 2.0. Off-Guard uses none of that
code — only the extracted game data — but the build script's provenance is
recorded in `ATTRIBUTION.md` regardless.
