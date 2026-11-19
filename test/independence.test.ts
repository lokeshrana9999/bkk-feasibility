// Independence controls for the rule oracle (fv-architecture section 2): the oracle is a second,
// blind reading of the texts, so it must share no code and no constants with the engine.
//  - nothing under oracle/ imports from outside oracle/ (in particular src/)
//  - nothing under src/ imports from oracle/
//  - oracle code names no engine identifier (PARAMS anywhere, including comments; every other
//    identifier exported by src/engine/ in code, with comments and strings removed)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORACLE = path.join(root, 'oracle');
const SRC = path.join(root, 'src');
const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Every module specifier: static import/export ... from, side-effect import, import(), require(). */
function specifiers(text: string): string[] {
  const out: string[] = [];
  const res = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  ];
  for (const re of res) for (const m of text.matchAll(re)) out.push(m[1]!);
  return out;
}

const inside = (dir: string, p: string) => {
  const rel = path.relative(dir, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Code with comments and string/template literals blanked (good enough for this scan). */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\[\s\S]|\$\{[^}]*\}|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

const oracleFiles = walk(ORACLE).filter((f) => CODE.test(f));
const srcFiles = walk(SRC).filter((f) => CODE.test(f));

describe('oracle independence', () => {
  it('finds the oracle and engine sources', () => {
    expect(oracleFiles.map((f) => path.relative(root, f).replace(/\\/g, '/'))).toContain('oracle/index.ts');
    expect(srcFiles.length).toBeGreaterThan(5);
  });

  it('nothing under oracle/ imports from outside oracle/ (no src/, no packages)', () => {
    const bad: string[] = [];
    for (const f of oracleFiles) {
      for (const s of specifiers(fs.readFileSync(f, 'utf8'))) {
        // a bare specifier is a package (node:*, clipper2-ts, ...): the oracle has no dependencies
        const ok = s.startsWith('.') && inside(ORACLE, path.resolve(path.dirname(f), s));
        if (!ok) bad.push(`${path.relative(root, f)} imports '${s}'`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('nothing under src/ imports from oracle/', () => {
    const bad: string[] = [];
    for (const f of srcFiles) {
      for (const s of specifiers(fs.readFileSync(f, 'utf8'))) {
        const hit = (s.startsWith('.') && inside(ORACLE, path.resolve(path.dirname(f), s))) || /(^|\/)oracle(\/|$)/.test(s);
        if (hit) bad.push(`${path.relative(root, f)} imports '${s}'`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('oracle code never mentions PARAMS (not even in a comment)', () => {
    const bad = oracleFiles.filter((f) => /\bPARAMS\b/.test(fs.readFileSync(f, 'utf8')));
    expect(bad.map((f) => path.relative(root, f))).toEqual([]);
  });

  it('oracle code uses no identifier exported by src/engine/', () => {
    const names = new Set<string>();
    for (const f of srcFiles) {
      const t = fs.readFileSync(f, 'utf8');
      for (const m of t.matchAll(/\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]!);
      for (const m of t.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
        for (const part of m[1]!.split(',')) {
          const n = part.trim().split(/\s+as\s+/).pop()?.trim();
          if (n) names.add(n);
        }
      }
    }
    expect(names.has('PARAMS')).toBe(true);
    expect(names.has('chainDistance')).toBe(true);
    const bad: string[] = [];
    for (const f of oracleFiles) {
      const code = codeOnly(fs.readFileSync(f, 'utf8'));
      for (const n of names) if (new RegExp(`(?<![\\w$])${n.replace(/\$/g, '\\$')}(?![\\w$])`).test(code)) bad.push(`${path.relative(root, f)}: ${n}`);
    }
    expect(bad).toEqual([]);
  });

  it('the scanner itself catches a planted import and a planted identifier', () => {
    const planted = "import { PARAMS } from '../src/engine/rules.js';\nconst x = chainDistance; // ok\nconst y = 'roadSetback';\n";
    expect(specifiers(planted)).toEqual(['../src/engine/rules.js']);
    expect(/(?<![\w$])chainDistance(?![\w$])/.test(codeOnly(planted))).toBe(true);
    expect(/(?<![\w$])roadSetback(?![\w$])/.test(codeOnly(planted))).toBe(false); // inside a string
    expect(specifiers("const m = await import('../src/x.js'); const n = require(\"oracle/index\");")).toEqual(['../src/x.js', 'oracle/index']);
  });
});
