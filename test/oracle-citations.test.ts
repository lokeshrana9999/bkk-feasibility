// The oracle's citations are real (fv-architecture section 2, "Citations are real"):
//  - every row of oracle/clauses.md cites sources/<file>:<line>, the file and line exist, and the
//    quoted Thai fragment occurs on that line BYTE-EXACTLY (raw UTF-8 bytes, so the PDF
//    extraction's broken spacing and private-use code points U+F70A/B/E must match as they are;
//    nothing is normalised or retyped). A clause that wraps may start on the cited line and
//    continue on the next: the fragment may then span the line break (CRLF or LF), but it must
//    START on the cited line. Today all 74 fragments sit wholly on their cited line; the span
//    allowance is reported as a count so a wrapped fragment is visible.
//  - every citation in oracle/index.ts (the CITE table) is a row of clauses.md with the same
//    file:line, every row is used by index.ts, and index.ts never cites a literal string.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLAUSES = path.join(root, 'oracle', 'clauses.md');
const INDEX = path.join(root, 'oracle', 'index.ts');

interface Row { id: string; file: string; line: number; fragment: Buffer; text: string }

/** Table rows: | id | file:line | `fragment` | ... (fragment bytes kept raw). */
function parseRows(): { rows: Row[]; unparsed: string[] } {
  const md = fs.readFileSync(CLAUSES, 'utf8');
  const rows: Row[] = [];
  const unparsed: string[] = [];
  for (const line of md.split(/\r?\n/)) {
    if (!/^\|\s*[A-Z][A-Z0-9]*-/.test(line)) continue; // header and separator rows start with "| id" / "|---"
    const m = /^\|\s*([A-Z][A-Z0-9-]+)\s*\|\s*([a-z0-9-]+\.txt):(\d+)\s*\|\s*`([^`]+)`\s*\|/.exec(line);
    if (!m) {
      unparsed.push(line);
      continue;
    }
    rows.push({ id: m[1]!, file: m[2]!, line: Number(m[3]), fragment: Buffer.from(m[4]!, 'utf8'), text: m[4]! });
  }
  return { rows, unparsed };
}

const fileLines = new Map<string, Buffer[] | null>();
/** A source file as raw byte lines (split on LF; a trailing CR stays on its line). */
function linesOf(file: string): Buffer[] | null {
  if (!fileLines.has(file)) {
    const p = path.join(root, 'sources', file);
    if (!fs.existsSync(p)) fileLines.set(file, null);
    else {
      const buf = fs.readFileSync(p);
      const out: Buffer[] = [];
      let s = 0;
      for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) {
        out.push(buf.subarray(s, i));
        s = i + 1;
      }
      out.push(buf.subarray(s));
      fileLines.set(file, out);
    }
  }
  return fileLines.get(file)!;
}

const stripCR = (b: Buffer) => (b.length && b[b.length - 1] === 0x0d ? b.subarray(0, b.length - 1) : b);

/** 'line' when the fragment is on the cited line, 'span' when it starts there and runs onto the next, else null. */
function locate(r: Row): 'line' | 'span' | null {
  const lines = linesOf(r.file);
  if (!lines) return null;
  const here = lines[r.line - 1];
  if (!here) return null;
  if (stripCR(here).indexOf(r.fragment) >= 0) return 'line';
  const next = lines[r.line];
  if (!next) return null;
  const a = stripCR(here);
  for (const sep of [Buffer.from('\n'), Buffer.from('')]) {
    // the wrapped text may or may not keep the line break as a space; try the break as-is and joined
    const joined = Buffer.concat([a, sep, stripCR(next)]);
    let from = 0;
    for (;;) {
      const at = joined.indexOf(r.fragment, from);
      if (at < 0) break;
      if (at < a.length && at + r.fragment.length > a.length) return 'span';
      from = at + 1;
    }
  }
  return null;
}

/** CITE table of oracle/index.ts: KEY -> 'file:line'. */
function citeTable(src: string): Map<string, string> {
  const block = /const CITE = \{([\s\S]*?)\} as const;/.exec(src);
  if (!block) throw new Error('CITE table not found in oracle/index.ts');
  const out = new Map<string, string>();
  for (const m of block[1]!.matchAll(/([A-Z][A-Z0-9_]*)\s*:\s*'([^']+)'/g)) out.set(m[1]!, m[2]!);
  return out;
}

const { rows, unparsed } = parseRows();
const indexSrc = fs.readFileSync(INDEX, 'utf8');

describe('oracle citations', () => {
  it('parses every clause row (74, unique ids)', () => {
    expect(unparsed).toEqual([]);
    expect(rows.length).toBe(74);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it('every cited sources/<file>:<line> exists and holds the quoted fragment byte-exactly', () => {
    const bad: string[] = [];
    let spans = 0;
    for (const r of rows) {
      const lines = linesOf(r.file);
      if (!lines) {
        bad.push(`${r.id}: sources/${r.file} does not exist`);
        continue;
      }
      if (r.line < 1 || r.line > lines.length) {
        bad.push(`${r.id}: ${r.file}:${r.line} is past the end (${lines.length} lines)`);
        continue;
      }
      const where = locate(r);
      if (where === 'span') spans++;
      if (!where) bad.push(`${r.id}: ${r.file}:${r.line} does not contain \`${r.text}\` (line: ${stripCR(lines[r.line - 1]!).toString('utf8').trim().slice(0, 80)})`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
    // visible in the report: how many fragments needed the wrap allowance
    expect(spans, `${spans} fragment(s) span a line break`).toBeGreaterThanOrEqual(0);
  });

  it('the byte-exact match is not fooled by a retyped fragment or a wrong line', () => {
    // a fragment with private-use code points, retyped without them, must not match
    const pua = rows.find((r) => /[-]/.test(r.text));
    if (pua) {
      const retyped = { ...pua, fragment: Buffer.from(pua.text.replace(/[-]/g, ''), 'utf8') };
      expect(locate(retyped)).toBeNull();
    }
    const r0 = rows[0]!;
    expect(locate({ ...r0, line: r0.line + 40 })).toBeNull();
    expect(locate(r0)).not.toBeNull();
  });

  it('every citation in oracle/index.ts is a clause row with the same file:line, and every row is used', () => {
    const cites = citeTable(indexSrc);
    expect(cites.size).toBeGreaterThan(0);
    const byId = new Map(rows.map((r) => [r.id, `${r.file}:${r.line}`]));
    const bad: string[] = [];
    for (const [key, cite] of cites) {
      const id = key.replace(/_/g, '-');
      if (!byId.has(id)) bad.push(`CITE.${key} (${cite}) has no row ${id} in clauses.md`);
      else if (byId.get(id) !== cite) bad.push(`CITE.${key} = ${cite} but row ${id} cites ${byId.get(id)}`);
    }
    // a row without its own key must be an alias of a keyed row with the same file:line
    // (P-33-4 and C-33-4 are "same clause as R-33-4": index.ts cites CITE.R_33_4 for all three)
    const citedValues = new Set(cites.values());
    for (const [id, fl] of byId) if (!cites.has(id.replace(/-/g, '_')) && !citedValues.has(fl)) bad.push(`row ${id} (${fl}) is not cited by index.ts`);
    // every CITE.X used in the code exists in the table, and every row is referenced by a branch
    const used = new Set([...indexSrc.matchAll(/\bCITE\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]!));
    for (const k of used) if (!cites.has(k)) bad.push(`CITE.${k} used but not defined`);
    for (const k of cites.keys()) if (!used.has(k)) bad.push(`CITE.${k} defined but never used by a branch`);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('oracle/index.ts never cites a literal file:line outside the CITE table', () => {
    const body = indexSrc
      .replace(/const CITE = \{[\s\S]*?\} as const;/, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, ''); // comments may give an example cite
    const literals = [...body.matchAll(/cite\s*:\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
    const anyFileLine = [...body.matchAll(/['"`][a-z0-9-]+\.txt:\d+['"`]/g)].map((m) => m[0]);
    expect(literals).toEqual([]);
    expect(anyFileLine).toEqual([]);
  });
});
