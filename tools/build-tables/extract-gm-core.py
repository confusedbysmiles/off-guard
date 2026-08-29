#!/usr/bin/env python3
"""
Transcribe the GM Core creature-building tables into JSON.

    python3 tools/build-tables/extract-gm-core.py "/path/to/PF 2e - GM Core.pdf"

Writes `tools/build-tables/gm-core-creature-building.json`, which
`npm run build:tables` turns into `src/rules/tables/creature-scaling.js`.

Why a script and not a hand transcription: nine tables, twenty-six rows each,
and a typo in one cell would be a wrong number in a live game that nobody could
trace. Every row here is checked against the level sequence it must follow and
against the column count it must have, and the build then cross-checks the
moderate column against six thousand published creatures.

The PDF is not in the repository and never will be. The JSON is, because the
engine has to run in a browser with no build behind it. These are ORC-licensed
tables; see `data/licenses/`.
"""
import json
import re
import sys
from pathlib import Path

try:
    import pypdf
except ImportError:  # pragma: no cover
    sys.exit("pypdf is not installed. `pip3 install pypdf` and try again.")

OUT = Path(__file__).resolve().parent / "gm-core-creature-building.json"

# Printed page == PDF page index in this book; `folio()` below proves it rather
# than trusting it, because a reprint with a different front matter would shift
# every citation silently.
FIRST, LAST = 112, 122

LEVELS = [-1] + list(range(0, 25))


def norm(text):
    """En dashes and minus signs become ASCII; non-breaking spaces become spaces."""
    return (text.replace("–", "-").replace("−", "-")
                .replace("—", "—").replace("\xa0", " "))


def mod(token):
    """`+11` / `19` / `-1` -> int. `—` -> None (the column does not apply)."""
    if token in ("—", "-—"):
        return None
    return int(token.replace("+", ""))


def midpoint(hi, lo):
    """
    A printed range, e.g. HP `26-24`, recorded as the value the engine uses.

    Half rounds up, always. `round()` would round half to even, which turns the
    Skills low column into +2 at level 0 and +4 at level 1 from ranges that are
    one apart in both cases -- a wobble with no cause in the book.
    """
    return (hi + lo + 1) // 2


# --- cell parsers -------------------------------------------------------------
#
# Each returns (values, tokens_consumed) so a row can mix widths.

def plain(n):
    def parse(tokens):
        return [mod(t) for t in tokens[:n]], n
    return parse


def ranged_last(n):
    """n columns where the last is printed as `+4 to +3`."""
    def parse(tokens):
        values = [mod(t) for t in tokens[:n - 1]]
        hi, _to, lo = tokens[n - 1:n + 2]
        values.append(midpoint(mod(hi), mod(lo)))
        return values, n + 2
    return parse


def ranges(n):
    """n columns each printed as `26-24`, or as a bare number when they coincide."""
    def parse(tokens):
        values = []
        for token in tokens[:n]:
            if "-" in token[1:]:
                hi, lo = token[1:].split("-", 1)
                values.append(midpoint(int(token[0] + hi), int(lo)))
            else:
                values.append(int(token))
        return values, n
    return parse


def damage(n):
    """n columns each printed as `2d8+7 (16)`; the printed average is what we keep."""
    def parse(tokens):
        values = []
        for i in range(n):
            average = tokens[i * 2 + 1]
            if not (average.startswith("(") and average.endswith(")")):
                raise ValueError(f"expected an average in parentheses, got {average!r}")
            values.append(int(average[1:-1]))
        return values, n * 2
    return parse


# --- the tables ---------------------------------------------------------------

TABLES = [
    ("attribute", "ATTRIBUTE MODIFIER SCALES", 114,
     ["extreme", "high", "moderate", "low"], plain(4)),
    ("perception", "PERCEPTION", 115,
     ["extreme", "high", "moderate", "low", "terrible"], plain(5)),
    ("skill", "SKILLS", 116,
     ["extreme", "high", "moderate", "low"], ranged_last(4)),
    ("ac", "ARMOR CLASS", 117,
     ["extreme", "high", "moderate", "low"], plain(4)),
    ("save", "SAVING THROWS", 118,
     ["extreme", "high", "moderate", "low", "terrible"], plain(5)),
    ("hp", "HIT POINTS", 118,
     ["high", "moderate", "low"], ranges(3)),
    ("attack", "STRIKE ATTACK BONUS", 120,
     ["extreme", "high", "moderate", "low"], plain(4)),
    ("damage", "STRIKE DAMAGE", 120,
     ["extreme", "high", "moderate", "low"], damage(4)),
    ("spell", "SPELL DC AND SPELL ATTACK MODIFIER", 121,
     ["extremeDc", "extremeAttack", "highDc", "highAttack", "moderateDc", "moderateAttack"],
     plain(6)),
]


def folio(page_text, expected):
    """The printed page number, which this book renders doubled: `117117`."""
    return re.search(rf"\b{expected}{expected}\b", page_text) is not None


def read(pdf_path):
    reader = pypdf.PdfReader(pdf_path)
    pages = {}
    for index in range(FIRST, LAST + 1):
        text = norm(reader.pages[index].extract_text())
        if not folio(text, index):
            sys.exit(
                f"PDF page {index} does not carry the printed folio {index}. "
                "This is a different printing; the citations would be wrong."
            )
        pages[index] = text
    return pages


def rows_after(text, heading, parse):
    """
    Read the rows following `heading`.

    Rows must arrive as -1, 0, 1, ... 24 with no gaps. That sequence is the
    check: a misread cell shifts the tokens and the next level stops matching,
    so the failure is loud instead of being one wrong number in a stat block.
    """
    start = text.index(heading) + len(heading)
    rows = {}
    expected = iter(LEVELS)
    want = next(expected)
    for line in text[start:].splitlines():
        tokens = line.split()
        if not tokens:
            continue
        try:
            level = int(tokens[0])
        except ValueError:
            continue
        if level != want:
            continue
        values, used = parse(tokens[1:])
        if len(tokens) - 1 < used:
            raise ValueError(f"{heading} level {level}: short row {line!r}")
        rows[str(level)] = values
        try:
            want = next(expected)
        except StopIteration:
            break
    return rows


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__.strip().splitlines()[2].strip())
    pages = read(sys.argv[1])
    # The tables that straddle a page break continue on the next one, and the
    # per-page sidebar between them holds no digits that start a line.
    joined = "\n".join(pages[i] for i in range(FIRST, LAST + 1))

    out = {}
    for key, heading, page, columns, parse in TABLES:
        rows = rows_after(joined, heading, parse)
        missing = [n for n in LEVELS if str(n) not in rows]
        if missing:
            sys.exit(f"{heading}: no row for level(s) {missing}")
        for level, values in rows.items():
            if len(values) != len(columns):
                sys.exit(f"{heading} level {level}: {len(values)} cells, expected {len(columns)}")
        out[key] = {
            "citation": f"GM Core pg. {page}",
            "columns": columns,
            "rows": rows,
        }
        print(f"  {heading:<34} {len(rows)} rows x {len(columns)}")

    OUT.write_text(json.dumps(out, indent=2) + "\n")
    print(f"Wrote {OUT}")


main()
