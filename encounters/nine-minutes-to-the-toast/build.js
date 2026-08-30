/**
 * Nine Minutes to the Toast — the run script, as a Word document.
 *
 * House style, as specified: Jost throughout, body 11pt in 4A4A4A at 1.5 line
 * spacing, US Letter with 1.25" margins, title left-aligned bold ~24pt in
 * near-black with the byline directly beneath in small italic.
 *
 * The green (#4EA72E) and its rules bracket poetry blocks and nothing else, so
 * the read-aloud boxes — which are not poetry — take a neutral treatment
 * instead: a warm paper tint and a dark left rule, which is also what a GM
 * actually needs, because the one thing that has to be findable at a glance
 * while running a game is the text you say out loud.
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType, PageBreak,
} = require('docx');

const FONT = 'Jost';
const INK = '4A4A4A';          // body, as specified
const NEAR_BLACK = '1A1A1A';   // titles and headings
const MUTED = '7A7A7A';
const READ_BG = 'F4F1E8';      // warm paper for read-aloud
const READ_RULE = '3D3833';
const TABLE_HEAD = 'EDEAE3';
const LETTER = { width: 12240, height: 15840 };
const MARGIN = 1800;           // 1.25"
const LINE = 360;              // 1.5 spacing (240 = single)

/* ---------- inline: **bold**, *italic*, `code` ---------------------------- */

function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0; let m;
  const push = (t, extra) => { if (t) out.push(new TextRun({ text: t, font: FONT, ...base, ...extra })); };
  while ((m = re.exec(text)) !== null) {
    push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) push(tok.slice(2, -2), { bold: true });
    else if (tok.startsWith('`')) push(tok.slice(1, -1), { font: 'Cascadia Mono', size: 19 });
    else push(tok.slice(1, -1), { italics: true });
    last = m.index + tok.length;
  }
  push(text.slice(last));
  return out.length ? out : [new TextRun({ text: '', font: FONT, ...base })];
}

const body = (text, opts = {}) => new Paragraph({
  children: runs(text, { size: 22, color: INK }),
  spacing: { line: LINE, after: 160 },
  ...opts,
});

/* ---------- blocks -------------------------------------------------------- */

function heading(text, level) {
  const sizes = { 2: 30, 3: 24 };
  return new Paragraph({
    children: runs(text, { size: sizes[level] ?? 24, bold: true, color: NEAR_BLACK }),
    heading: level === 2 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
    spacing: { before: level === 2 ? 420 : 300, after: 140, line: LINE },
    keepNext: true,
  });
}

/** Read-aloud. Tinted, indented, ruled on the left — never green. */
function readAloud(paras) {
  return paras.map((line, i) => new Paragraph({
    children: runs(line, { size: 22, color: '2A2622' }),
    spacing: { line: LINE, before: i === 0 ? 160 : 0, after: i === paras.length - 1 ? 200 : 120 },
    indent: { left: 460, right: 260 },
    shading: { type: ShadingType.CLEAR, fill: READ_BG, color: 'auto' },
    border: {
      left: { style: BorderStyle.SINGLE, size: 18, color: READ_RULE, space: 12 },
      top: i === 0 ? { style: BorderStyle.SINGLE, size: 2, color: READ_BG, space: 6 } : undefined,
      bottom: i === paras.length - 1 ? { style: BorderStyle.SINGLE, size: 2, color: READ_BG, space: 6 } : undefined,
    },
    keepLines: true,
  }));
}

const bullet = (text) => new Paragraph({
  children: runs(text, { size: 22, color: INK }),
  bullet: { level: 0 },
  spacing: { line: LINE, after: 80 },
});

const numbered = (text) => new Paragraph({
  children: runs(text, { size: 22, color: INK }),
  numbering: { reference: 'steps', level: 0 },
  spacing: { line: LINE, after: 80 },
});

/** A rule, as a paragraph bottom border — never a table, never green. */
const rule = () => new Paragraph({
  children: [new TextRun({ text: '', font: FONT, size: 2 })],
  spacing: { before: 200, after: 200 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D8D4CC', space: 1 } },
});

function table(rows) {
  const cols = rows[0].length;
  const total = 12240 - MARGIN * 2;
  const widths = cols === 2 ? [Math.round(total * 0.34), Math.round(total * 0.66)]
    : Array.from({ length: cols }, (_, i) => (i === cols - 1
      ? total - Math.round(total / cols) * (cols - 1)
      : Math.round(total / cols)));

  return new Table({
    columnWidths: widths,
    rows: rows.map((cells, r) => new TableRow({
      tableHeader: r === 0,
      children: cells.map((cell, c) => new TableCell({
        width: { size: widths[c], type: WidthType.DXA },
        shading: r === 0 ? { type: ShadingType.CLEAR, fill: TABLE_HEAD, color: 'auto' } : undefined,
        margins: { top: 90, bottom: 90, left: 130, right: 130 },
        children: [new Paragraph({
          children: runs(cell, { size: 21, color: r === 0 ? NEAR_BLACK : INK, bold: r === 0 || undefined }),
          spacing: { line: 300 },
        })],
      })),
    })),
  });
}

/* ---------- parse --------------------------------------------------------- */

// Input and output sit beside this script by default. Override either from the
// command line: `node build.js [input.md] [output.docx]`.
const HERE = __dirname;
const IN = process.argv[2] ? path.resolve(process.argv[2]) : path.join(HERE, 'run-script.md');
const OUT = process.argv[3] ? path.resolve(process.argv[3]) : path.join(HERE, 'nine-minutes-run-script.docx');

if (!fs.existsSync(IN)) {
  console.error(`No markdown at ${IN}\n\nUsage: node build.js [input.md] [output.docx]`);
  process.exit(1);
}

const src = fs.readFileSync(IN, 'utf8').split('\n');
const children = [];
let i = 0;

// Title and byline, from the top of the file.
children.push(new Paragraph({
  children: [new TextRun({ text: 'Nine Minutes to the Toast', font: FONT, bold: true, size: 48, color: NEAR_BLACK })],
  spacing: { after: 60, line: LINE },
}));
children.push(new Paragraph({
  children: [new TextRun({
    text: 'The run script  ·  level 12  ·  three PCs  ·  roughly four hours',
    font: FONT, italics: true, size: 20, color: MUTED,
  })],
  spacing: { after: 380, line: LINE },
}));

while (i < src.length) {
  const line = src[i];
  const t = line.trim();

  if (!t) { i += 1; continue; }
  if (/^#\s/.test(t)) { i += 1; continue; }                 // title already set

  // The italic subtitle is folded into the byline. It soft-wraps, so skip the
  // whole emphasis block rather than its first line — otherwise its tail
  // ("is for you.*") lands at the top of the document on its own.
  //
  // Matched on its actual opening words, not on "starts with an italic run".
  // The looser test ate the paragraph beginning "*Read aura* shows ..." and
  // everything after it up to the next line ending in an asterisk, which
  // silently removed a heading and two paragraphs from the middle of the
  // document. A parser that drops content has to be exact, not clever.
  if (/^\*A beat-by-beat/.test(t)) {
    while (i < src.length && !/\*\s*$/.test(src[i].trim())) i += 1;
    i += 1;
    continue;
  }

  if (/^---+$/.test(t)) { children.push(rule()); i += 1; continue; }

  if (/^###\s/.test(t)) { children.push(heading(t.replace(/^###\s/, ''), 3)); i += 1; continue; }
  if (/^##\s/.test(t)) { children.push(heading(t.replace(/^##\s/, ''), 2)); i += 1; continue; }

  // Read-aloud. Source lines are soft-wrapped, so join them into paragraphs
  // and break only on a blank quote line — one docx paragraph per source line
  // turns a sentence into a stack of orphans.
  if (t.startsWith('>')) {
    const paras = [];
    let buf = [];
    while (i < src.length && src[i].trim().startsWith('>')) {
      const stripped = src[i].trim().replace(/^>\s?/, '');
      if (stripped) buf.push(stripped);
      else if (buf.length) { paras.push(buf.join(' ')); buf = []; }
      i += 1;
    }
    if (buf.length) paras.push(buf.join(' '));
    children.push(...readAloud(paras));
    continue;
  }

  if (/^\|/.test(t)) {
    const rows = [];
    while (i < src.length && src[i].trim().startsWith('|')) {
      const cells = src[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
      i += 1;
    }
    // A two-column table whose header is empty is a definition list, not a
    // grid; keep the header row out of it so it does not read as a blank band.
    if (rows.length && rows[0].every((c) => c === '')) rows.shift();
    children.push(table(rows));
    children.push(new Paragraph({ children: [new TextRun({ text: '', font: FONT, size: 12 })], spacing: { after: 200 } }));
    continue;
  }

  // List items soft-wrap onto indented continuation lines. Swallow those into
  // the item; left alone they become body paragraphs sitting between the
  // numbers, which reads as the list being interrupted by prose.
  if (/^[-*]\s/.test(t) || /^\d+\.\s/.test(t)) {
    const ordered = /^\d+\.\s/.test(t);
    const parts = [t.replace(/^(?:[-*]|\d+\.)\s/, '')];
    i += 1;
    while (i < src.length && /^\s{2,}\S/.test(src[i]) && !/^\s*(?:[-*]|\d+\.)\s/.test(src[i])) {
      parts.push(src[i].trim());
      i += 1;
    }
    children.push((ordered ? numbered : bullet)(parts.join(' ')));
    continue;
  }

  // Paragraph: join soft-wrapped lines until a blank or a new block starts.
  const para = [];
  while (i < src.length) {
    const cur = src[i].trim();
    if (!cur || /^(#{1,3}\s|>|\||[-*]\s|\d+\.\s|---+$)/.test(cur)) break;
    para.push(cur);
    i += 1;
  }
  children.push(body(para.join(' ')));
}

/* ---------- document ------------------------------------------------------ */

const doc = new Document({
  creator: 'Sam Seim',
  title: 'Nine Minutes to the Toast — run script',
  description: 'GM run script for a Pathfinder 2e one-shot',
  numbering: {
    config: [{
      reference: 'steps',
      levels: [{
        level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: 460, hanging: 260 } } },
      }],
    }],
  },
  styles: {
    default: {
      document: { run: { font: FONT, size: 22, color: INK }, paragraph: { spacing: { line: LINE } } },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { width: LETTER.width, height: LETTER.height },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      },
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log(`wrote ${path.basename(OUT)} — ${Math.round(buf.length / 1024)}KB, ${children.length} blocks`);
}).catch((error) => {
  console.error('could not build the document:', error.message);
  process.exit(1);
});
