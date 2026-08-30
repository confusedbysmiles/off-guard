# run-script → Word

Rebuilds `nine-minutes-run-script.docx` from `run-script.md`, in the house style:
Jost throughout, 11pt body in `4A4A4A` at 1.5 line spacing, US Letter with 1.25"
margins, title left-aligned bold 24pt near-black with the byline beneath in small
italic.

```
npm install docx        # once
node build.js           # reads ./run-script.md, writes ./nine-minutes-run-script.docx
node build.js path/to/input.md path/to/output.docx
```

## What it does with the markdown

| Markdown | Word |
|---|---|
| `##` / `###` | Heading 1 / Heading 2, `keepNext` so a heading never ends a page |
| `> …` | Read-aloud: warm tint, indent, dark left rule. Soft-wrapped lines join; a blank `>` starts a new paragraph in the same block |
| `\| … \|` | A real Word table, header row shaded. A two-column table with an empty header renders as a definition list |
| `- ` / `1. ` | Bullets and a numbering config. Indented continuation lines fold into the item |
| `---` | A paragraph bottom border, not a table |
| `**b**` `*i*` `` `code` `` | Bold, italic, monospace |

## Two things that will bite

**The green is reserved.** `#4EA72E` and its rules bracket poetry blocks only,
never general dividers, so read-aloud takes a neutral tint and rule instead.

**The subtitle skip is matched on its exact opening words**, not on "a line that
starts with an italic run". The loose version ate the paragraph beginning
`*Read aura* shows …` and everything after it up to the next line ending in an
asterisk, silently removing a heading and two paragraphs from the middle of the
document. If you change the subtitle, change the match.

## Check it before trusting it

```
pandoc -t plain --wrap=none nine-minutes-run-script.docx | wc -w
```

Should land within ~0.5% of `wc -w run-script.md`. A parser that drops content
does it quietly, so compare the word counts, the heading count, and that every
`>` block survived — not just that the file opened.

Jost is not bundled. Without it installed, Word substitutes and the document is
correct but wrong-looking.
