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
  2. Where a book has no outline -- NPC Core has none at all, and several
     others bookmark only their chapters -- the stat-block titles are read off
     the pages as *display type*: a run of text whose size matches the run
     beside it reading "CREATURE 4", which is the header every stat block in
     the line carries. That pairing is what makes it safe. The name alone
     appears in prose all over a book; a name set at title size next to its own
     level, on the same baseline, is the top of an entry.
  3. The printed page number is read off the pages themselves rather than
     assumed to equal the PDF index. The offset between the two is worked out
     by vote across twenty sampled pages, and a book whose folio cannot be
     found is skipped, because a silent off-by-one would put every reference
     in it on the wrong page.
  4. Every match is then verified, and the two routes verify differently. A
     bookmark is checked against the page's text: the creature's name has to
     actually be on the page the bookmark points at. A display heading is
     checked against the catalogue: the level printed beside the name has to be
     the level the catalogue records. Two independent facts have to agree
     either way.

Anything that fails any of those is left out. Names are compared whole and
exactly -- "Orc Agriculturist" in the catalogue against "ORC AGRICULTURALIST"
in NPC Core is a miss, and stays a miss. `null` renders as "no page recorded",
which is honest; a wrong number sends someone flipping through the wrong
chapter mid-session.
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
    "Pathfinder NPC Core": "PF 2e - NPC Core.pdf",
    "Pathfinder War of Immortals": "PF 2e - War of Immortals.pdf",
    "Pathfinder Dark Archive (Remastered)": "PF 2e - Dark Archive (Remastered).pdf",
    # Pre-remaster books. Their creatures are mostly superseded by a Monster
    # Core entry and those are filtered out before we get here, but what is left
    # is the largest block of unreferenced creatures after NPC Core.
    "Pathfinder Bestiary": "Legacy/PF 2e - Bestiary 1.pdf",
    "Pathfinder Bestiary 2": "Legacy/PF 2e - Bestiary 2.pdf",
    "Pathfinder Bestiary 3": "Legacy/PF 2e - Bestiary 3.pdf",
    "Pathfinder Gamemastery Guide": "Legacy/PF 2e - Gamemastery Guide.pdf",
    "Pathfinder Core Rulebook": "Legacy/PF 2e - Core Rulebook [4th Printing].pdf",
    "Pathfinder Dark Archive": "Legacy/PF 2e - Dark Archive.pdf",
    "Pathfinder Guns & Gears": "Legacy/PF 2e - Guns & Gears.pdf",
}

# The header every stat block carries, once whitespace is taken out of it.
# Kerning splits it in the extracted text -- NPC Core renders "CREA TURE 1" --
# so the comparison happens with the spaces removed.
STAT_BLOCK_HEADER = re.compile(r"^(.*?)(?:CREATURE|HAZARD)(-?\d{1,2})$")

# A page number, as drawn. Some books render the folio doubled ("120120"); that
# is two runs of the same digits, so each run on its own is still a plain
# number.
FOLIO = re.compile(r"\d{1,3}")


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


def trim(text: str, tail: int) -> str:
    """
    Drop the last `tail` non-space characters of `text`.

    Headings are matched with the whitespace taken out, because kerning splits
    words in the extracted text -- NPC Core renders "CREATURE" as "CREA TURE".
    Counting back in non-space characters puts the match's boundary back where
    it belongs in the original.
    """
    kept = len(text)
    while tail > 0 and kept > 0:
        kept -= 1
        if not text[kept].isspace():
            tail -= 1
    return text[:kept].strip()


def page_numbers(page) -> set[int]:
    """Every one-to-three digit number drawn on a page, as a set."""
    numbers: set[int] = set()

    def visit(text, cm, tm, font_dict, font_size):
        stripped = text.strip()
        if FOLIO.fullmatch(stripped):
            numbers.add(int(stripped))

    try:
        page.extract_text(visitor_text=visit)
    except Exception:  # a page whose content stream will not parse
        return numbers
    return numbers


def folio_offset(reader: PdfReader) -> int | None:
    """
    How far the printed page number sits from the PDF page index.

    Rather than assert the two coincide, work it out, and then *test* it. Every
    page carries its folio and almost nothing else recurs, so proposing
    `index - number` for every number on twenty-odd sampled pages gives a short
    list of candidates in which the true offset is the one that appears most.
    But a plurality is not proof: Bestiary 1 renders facing pages, so half its
    sheets carry two folios and the winner led the runner-up by only 16 votes
    to 10.

    So the vote only nominates. The answer is the candidate that can be
    confirmed on nearly every sampled page -- for Bestiary 1, offset 0 is
    printed on 67 of 67, and offset -1 on half of them -- and a book where no
    candidate reaches that is skipped rather than guessed at. A constant
    off-by-one would put every reference in the book on the wrong page.
    """
    samples: list[tuple[int, set[int]]] = []
    total = len(reader.pages)
    for index in range(20, total - 10, max(1, (total - 30) // 24)):
        numbers = page_numbers(reader.pages[index])
        if numbers:
            samples.append((index, numbers))

    if len(samples) < 5:
        return None

    votes: dict[int, int] = {}
    for index, numbers in samples:
        for number in numbers:
            votes[index - number] = votes.get(index - number, 0) + 1

    # Confirm the nominees, best-supported first. Anything with less than a
    # tenth of the vote cannot reach the threshold below and is not worth the
    # pass over the samples.
    floor = len(samples) / 10
    ranked = sorted(
        (offset for offset, count in votes.items() if count >= floor),
        key=lambda offset: -votes[offset],
    )

    scored = sorted(
        ((sum(1 for i, n in samples if i - offset in n), offset) for offset in ranked),
        key=lambda pair: (-pair[0], abs(pair[1])),
    )
    if not scored:
        return None

    (confirmed, offset) = scored[0]
    runner_up = scored[1][0] if len(scored) > 1 else 0

    # Printed on nine pages in ten -- art plates and full-bleed spreads have no
    # folio -- and clear of whatever came second.
    if confirmed < 0.9 * len(samples) or confirmed < runner_up * 1.5:
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


def display_headings(reader: PdfReader) -> dict[tuple[str, int], int]:
    """
    Stat-block titles, read off the pages as display type.

    `(folded name, level) -> page index`, first occurrence wins.

    pypdf hands a visitor every text run with the matrix it was drawn under;
    `tm[0]` is the horizontal scale, which for these books is the type size.
    A stat block's title and its "CREATURE 4" are two runs at the same size on
    the same baseline, and the level run always follows the name run, so the
    pair is found by walking the runs in order.

    Requiring the pair is the whole point. The name on its own is set at title
    size in running heads and contents pages too, and appears in prose on any
    number of pages; a name beside its own printed level is the top of an entry
    and nothing else.
    """
    found: dict[tuple[str, int], int] = {}

    for index, page in enumerate(reader.pages):
        runs: list[tuple[float, float, str]] = []

        def visit(text, cm, tm, font_dict, font_size, runs=runs):
            stripped = text.strip()
            if stripped:
                runs.append((round(tm[0], 1), round(tm[5], 1), stripped))

        try:
            page.extract_text(visitor_text=visit)
        except Exception:  # a page whose content stream will not parse
            continue

        for n, (size, y, text) in enumerate(runs):
            flat = re.sub(r"\s+", "", text).replace("\u2013", "-").replace("\u2212", "-").upper()
            header = STAT_BLOCK_HEADER.match(flat)
            if not header:
                continue

            # Books differ on whether the title and its level are one run or
            # two. NPC Core sets them apart across the column and they arrive
            # separately; GM Core's hazards arrive as "HIDDEN PIT  HAZARD 0".
            if header.group(1):
                # One run. Trim the tail back off the original text, which
                # still has the whitespace the flattened copy lost.
                name = trim(text, len(flat) - len(header.group(1)))
            elif n == 0:
                continue
            else:
                previous_size, previous_y, name = runs[n - 1]
                # Same size, same baseline: one line of one heading. The
                # tolerance is for baselines that differ in the last decimal,
                # not for anything a reader would call a different line.
                if previous_size != size or abs(previous_y - y) > 2:
                    continue

            # Stat-block titles are set in capitals in every book in this
            # line. Requiring that is what keeps a sentence of body text that
            # happens to end "...defeat the creature 5" out of the results,
            # now that a title and its level can arrive as a single run.
            if name != name.upper() or len(name) > 60:
                continue

            key = (normalise(name), int(header.group(2)))
            if key[0] and key not in found:
                found[key] = index

    return found


def extract(book: str, pdf: Path, entries: list[dict]) -> dict | None:
    reader = PdfReader(str(pdf))

    offset = folio_offset(reader)
    if offset is None:
        print(f"  {book}: could not read printed page numbers off the pages. Skipped.")
        return None

    marks = outline_pages(reader)

    # Cache page text; several creatures share a page.
    text_cache: dict[int, str] = {}

    def page_text(index: int) -> str:
        if index not in text_cache:
            raw = reader.pages[index].extract_text() or ""
            text_cache[index] = normalise(raw)
        return text_cache[index]

    pages: dict[str, int] = {}
    from_outline = 0
    unmatched: list[dict] = []
    unverified: list[str] = []

    for entry in entries:
        key = normalise(entry["name"])
        page = marks.get(key)
        if page is None:
            unmatched.append(entry)
            continue
        # The bookmark says the entry is here; the page has to agree, and the
        # whole name has to be on it. An earlier version accepted the last word
        # alone, which sounds reasonable until you notice that "dragon" matches
        # every dragon in the book -- Conspirator Dragon was verified against the
        # Adamantine Dragon's page and nobody would have known. Line breaks are
        # not a problem: `normalise` has already collapsed them to spaces.
        if key in page_text(page):
            pages[entry["id"]] = page - offset
            from_outline += 1
        else:
            unverified.append(f'{entry["name"]} (bookmark says page {page - offset})')

    # Whatever the outline could not place, look for on the pages themselves.
    # Scanning every run of a 400-page book is not free, so it happens only
    # when there is something left to find.
    from_headings = 0
    if unmatched:
        headings = display_headings(reader)
        still: list[dict] = []
        for entry in unmatched:
            page = headings.get((normalise(entry["name"]), entry["level"]))
            if page is None:
                still.append(entry)
                continue
            pages[entry["id"]] = page - offset
            from_headings += 1
        unmatched = still

    print(
        f"  {book}: {len(pages)}/{len(entries)} pages "
        f"({100 * len(pages) / max(len(entries), 1):.0f}%)"
        f" - {from_outline} bookmarked, {from_headings} read off the page"
    )
    if unmatched:
        names = [e["name"] for e in unmatched]
        print(f"      {len(names)} not found, e.g. {', '.join(names[:4])}")
    if unverified:
        print(f"      {len(unverified)} dropped, page did not mention the creature:")
        for line in unverified[:6]:
            print(f"        {line}")

    return {
        "book": book,
        "note": (
            f"Extracted from {pdf.name} by tools/build-pages/extract.py: "
            f"{from_outline} from the bookmark outline, verified by checking that "
            "the creature's name appears on the page the bookmark points at; "
            f"{from_headings} from stat-block titles read off the pages as display "
            "type, verified by checking that the level printed beside the name is "
            "the level the catalogue records. "
            f"Printed page = PDF index - {offset}. "
            f"{len(unmatched)} entries in this book were not found either way and "
            "have no page here."
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
