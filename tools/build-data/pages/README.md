# Page references

The upstream Foundry data carries no page numbers. Its publication block is
`{ license, remaster, title, authors }` on all 7,726 entries — there is no page
field anywhere in the repository, so `source.page` cannot be derived.

This directory is the hand-maintained override. Each file is one book:

```json
{
  "book": "Pathfinder Monster Core",
  "note": "Verified against the first printing, 2024.",
  "pages": {
    "goblin-warrior": 178,
    "cinder-dragon-ancient": 116
  }
}
```

Keys are Off-Guard entry ids (the slug in `data/creatures/<pack>.json`), not
Foundry ids, so a re-pin of the upstream commit does not invalidate the table.
`npm run build:data` merges these into `source.page` and reports any key that
matches no entry, so a typo surfaces at build time rather than as a silent
`null`.

Only add a number you have checked against the book in front of you. A wrong
page reference is worse than no page reference: `null` renders as "no page
recorded" in the stat block footer, which is honest, whereas a wrong number
sends someone flipping through the wrong chapter mid-session.
