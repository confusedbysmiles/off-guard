#!/usr/bin/env python3
"""
Extract creature page references from Paizo's own PDFs.

    python3 tools/build-pages/extract.py --books "/path/to/Rulebooks"

This is a **local, one-off tool**, and deliberately not wired into `npm run
build:data`. It needs PDFs that are not in this repository and never will be,
and it is Python because Node has no PDF reader in its standard library and the
alternative was an npm dependency carried forever for a script run once a year.
Nothing in the application depends on it. What it writes --
`tools/build-data/pages/*.json` -- is checked in, and that is what the build
reads.

    python3 -m pip install pypdf     # the only requirement

How the page numbers are obtained, and why they can be trusted:

  1. Paizo's PDFs carry a bookmark outline with an entry per creature, whose
     destination is the page the entry starts on. That is the book's own
     statement about where its contents are, not a guess.
  2. The printed page number is read off the pages themselves rather than
     assumed to equal the PDF index. The offset between the two is worked out
     by vote across twenty sampled pages, and a book whose folio cannot be
     found is skipped, because a silent off-by-one would put every reference
     in it on the wrong page.
  3. Every match is then verified against the page itself: the creature's name
     must actually appear in that page's text. A bookmark whose page does not
     mention the creature is dropped and reported rather than written.

Anything that fails any of those is left out. `null` renders as "no page
recorded", which is honest; a wrong number sends someone flipping through the
wrong chapter mid-session.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover - a setup problem, not a runtime one
    sys.exit("pypdf is not installed. Run: python3 -m pip install pypdf")

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "tools/build-data/pages"

# Book title as it appears in `data/index.json` -> the PDF's filename.
BOOKS = {
    "Pathfinder Monster Core": "PF 2e - Monster Core.pdf",
    "Pathfinder Monster Core 2": "PF 2e - Monster Core 2.pdf",
    "Pathfinder Book of the Dead": "PF 2e - Book of the Dead.pdf",
    "Pathfinder Rage of Elements": "PF 2e - Rage of Elements.pdf",
    "Pathfinder Howl of the Wild": "PF 2e - Howl of the Wild.pdf",
    "Pathfinder Battlecry!": "PF 2e - Battlecry!.pdf",
    "Pathfinder GM Core": "PF 2e - GM Core.pdf",
    "Pathfinder Player Core": "PF 2e - Player Core 1.pdf",
    "Pathfinder Player Core 2": "PF 2e - Player Core 2.pdf",
}


def normalise(text: str) -> str:
    """
    Fold a name to the form both sides can be compared in.

    Bookmarks disambiguate with a parenthetical the catalogue does not use --
    "Cassisian (Archive Angel)" against "Cassisian" -- so the parenthetical is
    dropped. Everything else is accent-folded and reduced to words.
    """
    text = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode()
    text = re.sub(r"\(.*?\)", " ", text.lower())
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def folio_offset(reader: PdfReader) -> int | None:
    """
    How far the printed page number sits from the PDF page index.

    Rather than assert the two coincide, work it out. For twenty-odd sampled
    pages, collect the numbers printed at the top and bottom of the page and
    propose `index - number` as the offset. The folio is the only number that
    appears on every page, so the true offset is the one that recurs; a caption,
    a creature level or a DC contributes a scattered vote and loses.

    Returns None when no offset commands a clear majority, which is the signal
    to skip the book rather than guess -- a constant off-by-one would put every
    reference in it on the wrong page.
    """
    votes: dict[int, int] = {}
    sampled = 0
    total = len(reader.pages)
    for index in range(20, total - 10, max(1, (total - 30) // 24)):
        text = (reader.pages[index].extract_text() or "").strip()
        if not text:
            continue
        sampled += 1
        # No word boundaries: these PDFs render the folio doubled in the
        # extracted text ("120120"), and \b would refuse to see the 120 in it.
        for found in set(re.findall(r"\d{1,3}", f"{text[:40]} {text[-40:]}")):
            votes[index - int(found)] = votes.get(index - int(found), 0) + 1

    if sampled < 5 or not votes:
        return None

    ranked = sorted(votes.items(), key=lambda kv: -kv[1])
    (offset, count) = ranked[0]
    runner_up = ranked[1][1] if len(ranked) > 1 else 0

    # A decisive lead rather than a fixed share of the pages. Art plates and
    # sidebars have no folio and drag the winner's share down -- Book of the
    # Dead's true offset carries only 56% of sampled pages -- but the runner-up
    # is noise and never comes close. Requiring the winner to be several times
    # the next candidate refuses a genuinely ambiguous book without refusing a
    # heavily illustrated one.
    if count < 5 or count < runner_up * 3:
        return None
    return offset


def outline_pages(reader: PdfReader) -> dict[str, int]:
    """Every bookmark, folded name -> page. First occurrence wins."""
    found: dict[str, int] = {}

    def walk(items):
        for item in items:
            if isinstance(item, list):
                walk(item)
                continue
            try:
                page = reader.get_page_number(item.page)
            except Exception:
                continue
            key = normalise(item.title)
            if key and key not in found:
                found[key] = page

    walk(reader.outline)
    return found


def extract(book: str, pdf: Path, entries: list[dict]) -> dict | None:
    reader = PdfReader(str(pdf))

    offset = folio_offset(reader)
    if offset is None:
        print(f"  {book}: could not read printed page numbers off the pages. Skipped.")
        return None

    marks = outline_pages(reader)
    if not marks:
        print(f"  {book}: no bookmark outline. Skipped.")
        return None

    # Cache page text; several creatures share a page.
    text_cache: dict[int, str] = {}

    def page_text(index: int) -> str:
        if index not in text_cache:
            raw = reader.pages[index].extract_text() or ""
            text_cache[index] = normalise(raw)
        return text_cache[index]

    pages: dict[str, int] = {}
    unmatched: list[str] = []
    unverified: list[str] = []

    for entry in entries:
        key = normalise(entry["name"])
        page = marks.get(key)
        if page is None:
            unmatched.append(entry["name"])
            continue
        # The bookmark says the entry is here; the page has to agree, and the
        # whole name has to be on it. An earlier version accepted the last word
        # alone, which sounds reasonable until you notice that "dragon" matches
        # every dragon in the book -- Conspirator Dragon was verified against the
        # Adamantine Dragon's page and nobody would have known. Line breaks are
        # not a problem: `normalise` has already collapsed them to spaces.
        body = page_text(page)
        if key in body:
            pages[entry["id"]] = page - offset
        else:
            unverified.append(f'{entry["name"]} (bookmark says page {page - offset})')

    print(
        f"  {book}: {len(pages)}/{len(entries)} pages "
        f"({100 * len(pages) / max(len(entries), 1):.0f}%)"
    )
    if unmatched:
        print(f"      {len(unmatched)} not bookmarked, e.g. {', '.join(unmatched[:4])}")
    if unverified:
        print(f"      {len(unverified)} dropped, page did not mention the creature:")
        for line in unverified[:6]:
            print(f"        {line}")

    return {
        "book": book,
        "note": (
            f"Extracted from the bookmark outline of {pdf.name} by "
            "tools/build-pages/extract.py, and verified by checking that each "
            "creature's name appears on the page the bookmark points at "
            f"(printed page = PDF index - {offset}). "
            f"{len(unmatched)} entries in this book are not bookmarked and have "
            "no page here."
        ),
        "pages": dict(sorted(pages.items())),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--books", required=True, help="directory holding the PDFs")
    parser.add_argument("--only", help="one book title, to redo a single table")
    args = parser.parse_args()

    index_file = ROOT / "data/index.json"
    if not index_file.exists():
        sys.exit("data/index.json is missing. Run `npm run build:data` first.")
    rows = json.loads(index_file.read_text())
    rows = rows.get("rows", rows)

    books_dir = Path(args.books)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for book, filename in BOOKS.items():
        if args.only and args.only != book:
            continue
        pdf = books_dir / filename
        if not pdf.exists():
            print(f"  {book}: {filename} not found. Skipped.")
            continue

        entries = [
            r for r in rows
            if r.get("book") == book and not r.get("supersededBy")
        ]
        if not entries:
            continue

        table = extract(book, pdf, entries)
        if table is None or not table["pages"]:
            continue

        slug = re.sub(r"[^a-z0-9]+", "-", book.lower()).strip("-")
        out = OUT_DIR / f"{slug}.json"
        out.write_text(json.dumps(table, indent=2, ensure_ascii=False) + "\n")
        print(f"      wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
