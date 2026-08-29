# Page references

The upstream Foundry data carries no page numbers. Its publication block is
`{ license, remaster, title, authors }` on all 7,726 entries — there is no page
field anywhere in the repository, so `source.page` cannot be derived.

This directory holds one file per book. Almost all of it is written by
`tools/build-pages/extract.py`, which reads the numbers out of Paizo's own PDFs;
the `note` on each file records how many came from the book's bookmark outline,
how many were read off the pages as display type, and what the offset between
the printed page and the PDF index was. Hand entry is still supported and takes
the same shape:

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

Editing a generated file by hand works, but the next run of the extractor
overwrites it. A correction that has to survive belongs in the extractor.

Only add a number you have checked against the book in front of you. A wrong
page reference is worse than no page reference: `null` renders as "no page
recorded" in the stat block footer, which is honest, whereas a wrong number
sends someone flipping through the wrong chapter mid-session.
