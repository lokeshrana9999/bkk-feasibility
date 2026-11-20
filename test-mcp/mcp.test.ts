// MCP server over JSON-RPC: initialize, tools/list, every tool, the resource and prompt, typed
// errors on bad input, G1 parity with the engine, the HTTP edges (landing page, CORS, rate limit),
// the stdio entry and the committed Vercel bundle.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { evaluate } from '../src/engine/evaluate.js';
import type { EngineInput } from '../src/engine/types.js';
import { readHash } from '../src/ui/state';
import { DISCLAIMER, summarize } from '../mcp/core';
import { SiteData, diskSource } from '../mcp/data';
import { createHandler } from '../mcp/http';
import { SOI38_RING } from '../mcp/landing';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORIGIN = 'https://example.test';
const data = new SiteData(diskSource(`${ROOT}public/data`));
const handle = createHandler({ data, rateLimit: { max: 10_000, windowMs: 60_000 } });

let seq = 0;
async function rpc(method: string, params: Record<string, unknown> = {}, h = handle) {
  const res = await h(
    new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
    }),
  );
  return { status: res.status, body: (await res.json()) as { result?: any; error?: { code: number; message: string } } };
}

async function tool(name: string, args: Record<string, unknown> = {}) {
  const { status, body } = await rpc('tools/call', { name, arguments: args });
  expect(status).toBe(200);
  expect(body.error).toBeUndefined();
  const r = body.result;
  return { isError: !!r.isError, v: r.structuredContent as any, text: r.content[0].text as string };
}

const SOI38 = JSON.parse(SOI38_RING) as [number, number][];
// G1 of test/golden.test.ts and scripts/demo.ts
const G1: EngineInput = {
  units: 'm',
  ring: [[0, 0], [50, 0], [50, 40], [0, 40]],
  edges: [
    { role: 'road', width: 12, name: 'Soi A', source: 'user' },
    { role: 'private', source: 'user' },
    { role: 'private', source: 'user' },
    { role: 'private', source: 'user' },
  ],
  zone: { code: 'ย.๙-๒๓', far: 7, osrPct: 4.5 },
  type: 'condo',
  nearStation: false,
};

describe('protocol', () => {
  it('initialize: server info, tools / resources / prompts, instructions', async () => {
    const { status, body } = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    expect(status).toBe(200);
    expect(body.result.serverInfo.name).toBe('bkk-feasibility');
    expect(Object.keys(body.result.capabilities)).toEqual(expect.arrayContaining(['tools', 'resources', 'prompts']));
    expect(body.result.instructions).toMatch(/not a legal opinion/);
  });

  it('tools/list: the five read-only tools', async () => {
    const { body } = await rpc('tools/list');
    const tools = body.result.tools as { name: string; annotations: Record<string, boolean>; inputSchema: { properties?: Record<string, unknown> } }[];
    expect(tools.map((t) => t.name).sort()).toEqual(['about', 'detect_roads', 'evaluate_plot', 'find_zone', 'get_rules']);
    for (const t of tools) expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(Object.keys(tools.find((t) => t.name === 'evaluate_plot')!.inputSchema.properties!)).toEqual(expect.arrayContaining(['ring', 'building_type', 'edges', 'floor_heights']));
  });

  it('resource rules://y9 and prompt feasibility_report', async () => {
    const list = await rpc('resources/list');
    expect(list.body.result.resources.map((r: { uri: string }) => r.uri)).toContain('rules://y9');
    const read = await rpc('resources/read', { uri: 'rules://y9' });
    const table = JSON.parse(read.body.result.contents[0].text);
    expect(table.rules.length).toBe(23);
    expect(table.rules[0]).toMatchObject({ id: 'Z16-FAR', article: expect.any(String), quoteTh: expect.stringContaining('๗') });
    const p = await rpc('prompts/get', { name: 'feasibility_report', arguments: { plot: SOI38_RING, building_type: 'office' } });
    const text = p.body.result.messages[0].content.text as string;
    expect(text).toContain('evaluate_plot');
    expect(text).toContain('office');
  });
});

describe('tools', () => {
  it('about: scope, sources, links built from the request host', async () => {
    const { v } = await tool('about');
    expect(v.ok).toBe(true);
    expect(v.scope.zone).toMatch(/ย\.9/);
    expect(v.links.app).toBe(ORIGIN);
    expect(v.links.mcp).toBe(`${ORIGIN}/mcp`);
    expect(v.decisionsToTake.length).toBe(7);
    expect(v.disclaimer).toBe(DISCLAIMER);
  });

  it('find_zone: Sukhumvit 38 is ย.๙-๒๓; elsewhere is out of scope or off the map', async () => {
    const a = await tool('find_zone', { lat: 13.72092, lng: 100.57957 });
    expect(a.v).toMatchObject({ ok: true, inScope: true, zone: { code: 'ย.๙-๒๓', codeLatin: 'Y9-23', far: 7, osrPct: 4.5 } });
    const far = await tool('find_zone', { lat: 0, lng: 0 });
    expect(far.v).toMatchObject({ ok: true, inScope: false, zone: null });
    const bad = await tool('find_zone', { lat: 100.5, lng: 13.7 });
    expect(bad.isError).toBe(true);
    expect(bad.v.code).toBe('invalid-input');
  });

  it('get_rules: cited rows by type; typed errors', async () => {
    const c = await tool('get_rules', { zone: 'Y9-23', building_type: 'condo' });
    const ids = c.v.rules.map((r: { id: string }) => r.id);
    expect(ids).toContain('ORD49-2X');
    expect(ids).not.toContain('Z16-HOTEL');
    expect(c.v.zone.far).toBe(7);
    expect(c.v.rules[0].quoteTh).toBeTruthy();
    const h = await tool('get_rules', { lat: 13.72092, lng: 100.57957, building_type: 'hotel' });
    expect(h.v.rules.map((r: { id: string }) => r.id)).toContain('Z16-HOTEL');
    expect((await tool('get_rules', { zone: 'Y9-99', building_type: 'condo' })).v.code).toBe('unknown-zone');
    expect((await tool('get_rules', { building_type: 'condo' })).v.code).toBe('invalid-input');
  });

  it('detect_roads: the Soi 38 demo plot fronts a road with a measured width', async () => {
    const { v } = await tool('detect_roads', { ring: SOI38 });
    expect(v.ok).toBe(true);
    expect(v.zone.code).toBe('ย.๙-๒๓');
    expect(v.edges.length).toBe(v.plot.buildableRing.length);
    expect(v.roads.length).toBeGreaterThan(0);
    for (const r of v.roads) expect(r.widthM).toBeGreaterThanOrEqual(1);
    expect(v.plot.buildableAreaM2).toBeGreaterThan(1000);
  });

  it('evaluate_plot (metres): G1 equals the engine, number for number', async () => {
    const { v } = await tool('evaluate_plot', {
      ring: G1.ring,
      units: 'm',
      zone: 'ย.๙-๒๓',
      building_type: 'condo',
      edges: [{ index: 0, role: 'road', width: 12, name: 'Soi A' }],
      detail: 'full',
    });
    const eng = evaluate(G1);
    if (!eng.ok) throw new Error(eng.message);
    const s = summarize(eng);
    expect(v.ok).toBe(true);
    expect(v.regimes).toEqual(s.regimes);
    expect(v.designs).toEqual(s.designs);
    expect(v.rulesApplied).toEqual(s.rulesApplied);
    expect(v.warnings).toEqual(s.warnings);
    expect(v.plot.areaM2).toBe(2000);
    // golden figures (test/golden.test.ts): high regime chosen, 29 floors
    expect(v.regimes.chosen).toBe('high');
    expect(v.regimes.high.floors).toBe(29);
    expect(v.shareLink).toBeNull();
    expect(v.disclaimer).toBe(DISCLAIMER);
  });

  it('evaluate_plot (lon/lat): a real plot, brief by default, share link in the app hash format', async () => {
    const { v, text } = await tool('evaluate_plot', { ring: SOI38, building_type: 'condo' });
    expect(v.ok).toBe(true);
    expect(v.zone.code).toBe('ย.๙-๒๓');
    expect(v.headline).toMatch(/m2 permitted/);
    expect(v.regimes.low.floorPlates).toBeUndefined();
    expect(v.designs.length).toBeGreaterThan(0);
    for (const d of v.designs) expect(d.checks.every((c: { status: string }) => c.status !== 'pass')).toBe(true);
    expect(text).toContain('not a legal opinion');
    expect(v.shareLink.startsWith(`${ORIGIN}/#p=`)).toBe(true);
    const h = readHash(v.shareLink.slice(ORIGIN.length + 1));
    expect(h.bad).toEqual([]);
    expect(h.type).toBe('condo');
    expect(h.ring!.length).toBe(4);
  });

  it('evaluate_plot: edge overrides change the result and land in the share link', async () => {
    const base = await tool('evaluate_plot', { ring: SOI38, building_type: 'office' });
    const road = base.v.plot.edges.find((e: { role: string }) => e.role === 'road');
    expect(road).toBeTruthy();
    const wide = await tool('evaluate_plot', { ring: SOI38, building_type: 'office', edges: [{ index: road.index, role: 'road', width: 30 }] });
    expect(wide.v.plot.edges[road.index]).toMatchObject({ role: 'road', widthM: 30, source: 'user' });
    expect(wide.v.regimes.high.envelopeGfaM2).not.toBe(base.v.regimes.high.envelopeGfaM2);
    expect(readHash(wide.v.shareLink.slice(ORIGIN.length + 1)).edges).toEqual({ [road.index]: { role: 'road', width: 30 } });
  });

  it('evaluate_plot full detail keeps the floor tables and Thai quotes', async () => {
    const { v } = await tool('evaluate_plot', { ring: SOI38, building_type: 'condo', detail: 'full' });
    expect(v.regimes[v.regimes.chosen].floorPlates.length).toBe(v.regimes[v.regimes.chosen].floors);
    expect(v.rulesApplied[0].quoteTh).toBeTruthy();
  });
});

describe('share link: the URL alone reproduces the evaluation (no server state)', () => {
  /** evaluate_plot arguments rebuilt from nothing but the link's hash, as the web app reads it. */
  function argsFromLink(link: string) {
    const h = readHash(link.slice(link.indexOf('#')));
    expect(h.bad).toEqual([]);
    return {
      ring: h.ring,
      building_type: h.type,
      edges: Object.entries(h.edges ?? {}).map(([i, o]) => ({ index: Number(i), ...o })),
      near_station: h.station,
      wider_road_relief: h.relief,
      floor_heights: h.floorH,
      hotel_rooms: h.hotelRooms,
      detail: 'full',
    };
  }
  // 10-decimal corners: the link keeps 7, so the MCP must evaluate the rounded outline too
  const fine = SOI38.map(([x, y]) => [x + 3.3e-9, y - 4.4e-9]);
  const cases: [string, Record<string, unknown>][] = [
    ['condo, detected roads', { ring: SOI38, building_type: 'condo' }],
    ['10-decimal corners', { ring: fine, building_type: 'apartment' }],
    ['office, overrides and every option', { ring: SOI38, building_type: 'office', edges: [{ index: 0, role: 'road', width: 30, gap: 1 }, { index: 2, role: 'canal', width: 8 }], near_station: true, wider_road_relief: false, floor_heights: { ground: 5, typical: 3.5 } }],
    ['hotel with a room count', { ring: SOI38, building_type: 'hotel', hotel_rooms: 200 }],
  ];
  for (const [name, args] of cases) {
    it(name, async () => {
      const a = (await tool('evaluate_plot', { ...args, detail: 'full' })).v;
      expect(a.ok).toBe(true);
      const b = (await tool('evaluate_plot', argsFromLink(a.shareLink))).v;
      expect(b.ok).toBe(true);
      expect(b.inputs).toEqual(a.inputs);
      expect(b.plot).toEqual(a.plot);
      expect(b.regimes).toEqual(a.regimes);
      expect(b.designs).toEqual(a.designs);
      expect(b.rulesApplied).toEqual(a.rulesApplied);
      expect(b.shareLink).toBe(a.shareLink);
    });
  }

  it('hotel rooms travel in the link (hr=) and change the gate', async () => {
    const few = (await tool('evaluate_plot', { ring: SOI38, building_type: 'hotel', hotel_rooms: 60 })).v;
    expect(few.shareLink).toContain('&hr=60');
    expect(readHash(few.shareLink.slice(few.shareLink.indexOf('#'))).hotelRooms).toBe(60);
    const est = (await tool('evaluate_plot', { ring: SOI38, building_type: 'hotel' })).v;
    expect(est.shareLink).not.toContain('hr=');
  });

  it('detect_roads also links to the app', async () => {
    const { v } = await tool('detect_roads', { ring: SOI38 });
    expect(v.appLink).toBe(`${ORIGIN}/#p=${SOI38.map((q) => `${q[0].toFixed(7)},${q[1].toFixed(7)}`).join(';')}&t=condo`);
  });
});

describe('typed errors', () => {
  const circle = (n: number, r: number): [number, number][] =>
    Array.from({ length: n }, (_, i) => [100.5796 + (r / 108000) * Math.cos((2 * Math.PI * i) / n), 13.721 + (r / 110600) * Math.sin((2 * Math.PI * i) / n)]);
  const cases: [string, Record<string, unknown>, string][] = [
    ['too few corners', { ring: SOI38.slice(0, 2) }, 'too-few-points'],
    ['501 corners', { ring: circle(501, 60) }, 'too-many-vertices'],
    ['over 200,000 m2', { ring: circle(40, 400) }, 'too-large'],
    ['self-crossing', { ring: [SOI38[0], SOI38[2], SOI38[1], SOI38[3]] }, 'self-intersection'],
    ['lat / lon swapped', { ring: SOI38.map(([x, y]) => [y, x]) }, 'invalid-input'],
    ['outside Bangkok', { ring: [[0, 0], [0.0005, 0], [0.0005, 0.0005]] }, 'outside-scope'],
    ['edge index out of range', { ring: SOI38, edges: [{ index: 9, role: 'road', width: 10 }] }, 'invalid-override'],
    ['road narrower than 1 m', { ring: SOI38, edges: [{ index: 0, role: 'road', width: 0.5 }] }, 'invalid-override'],
    ['width on a neighbour edge', { ring: SOI38, edges: [{ index: 0, role: 'private', width: 5 }] }, 'invalid-override'],
    ['floor height 1 m', { ring: SOI38, floor_heights: { ground: 1, typical: 3 } }, 'invalid-input'],
    ['metres without a zone', { ring: G1.ring, units: 'm' }, 'invalid-input'],
    ['zone on a lon/lat plot', { ring: SOI38, zone: 'Y9-23' }, 'invalid-input'],
  ];
  for (const [name, args, code] of cases) {
    it(`${name} -> ${code}`, async () => {
      const { isError, v } = await tool('evaluate_plot', { building_type: 'condo', ...args });
      expect(isError).toBe(true);
      expect(v).toMatchObject({ ok: false, code });
      expect(typeof v.message).toBe('string');
    });
  }

  it('a plot outside ย.9 names its zone', async () => {
    // Silom / Sathorn business area, zone พ.๕-๖ (FAR 10), not ย.9
    const r = await tool('find_zone', { lat: 13.7246, lng: 100.5302 });
    expect(r.v).toMatchObject({ inScope: false, zone: { code: 'พ.๕-๖', far: 10 } });
    const d = 0.0003;
    const ring = [[100.5302, 13.7246], [100.5302 + d, 13.7246], [100.5302 + d, 13.7246 + d], [100.5302, 13.7246 + d]];
    const { v } = await tool('detect_roads', { ring });
    expect(v.code).toBe('outside-scope');
    expect(v.zone.inScope).toBe(false);
    expect(v.message).toContain(v.zone.code);
  });

  it('schema violations are refused before the engine runs', async () => {
    const { status, body } = await rpc('tools/call', { name: 'evaluate_plot', arguments: { ring: SOI38, building_type: 'castle' } });
    expect(status).toBe(200);
    const refused = body.error !== undefined || body.result?.isError === true;
    expect(refused).toBe(true);
  });
});

describe('http', () => {
  it('GET serves the landing page with setup for this host', async () => {
    const res = await handle(new Request('https://generalmachines.example/mcp', { headers: { Accept: 'text/html' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('claude mcp add --transport http bkk-feasibility https://generalmachines.example/mcp');
    expect(html).toContain('evaluate_plot');
  });

  it('GET for an event stream is 405 (stateless); OPTIONS answers CORS', async () => {
    const sse = await handle(new Request(`${ORIGIN}/mcp`, { headers: { Accept: 'text/event-stream' } }));
    expect(sse.status).toBe(405);
    const pre = await handle(new Request(`${ORIGIN}/mcp`, { method: 'OPTIONS' }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('curl without the Accept header still works; bad JSON is a parse error', async () => {
    const res = await handle(new Request(`${ORIGIN}/mcp`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).result.tools.length).toBe(5);
    const bad = await handle(new Request(`${ORIGIN}/mcp`, { method: 'POST', body: '{nope' }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error.code).toBe(-32700);
  });

  it('rate limit per client IP', async () => {
    const h = createHandler({ data, rateLimit: { max: 3, windowMs: 60_000 } });
    const call = (ip: string) =>
      h(new Request(`${ORIGIN}/mcp`, { method: 'POST', headers: { 'x-real-ip': ip, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }));
    for (let i = 0; i < 3; i++) expect((await call('1.2.3.4')).status).toBe(200);
    const over = await call('1.2.3.4');
    expect(over.status).toBe(429);
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await call('5.6.7.8')).status).toBe(200);
  });

  it('the share link follows the request host (domain-agnostic)', async () => {
    const res = await handle(
      new Request('http://internal/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-host': 'generalmachines.example', 'x-forwarded-proto': 'https' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'evaluate_plot', arguments: { ring: SOI38, building_type: 'condo' } } }),
      }),
    );
    const v = ((await res.json()) as any).result.structuredContent;
    expect(v.shareLink.startsWith('https://generalmachines.example/#p=')).toBe(true);
  });
});

describe('entries', () => {
  it('stdio: npm run mcp:stdio speaks MCP', async () => {
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [`${ROOT}node_modules/tsx/dist/cli.mjs`, `${ROOT}mcp/stdio.ts`], cwd: ROOT, stderr: 'pipe' }));
    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBe(5);
      const r = await client.callTool({ name: 'find_zone', arguments: { lat: 13.72092, lng: 100.57957 } });
      expect((r.structuredContent as any).zone.code).toBe('ย.๙-๒๓');
    } finally {
      await client.close();
    }
  });

  it('api/mcp.js is the current bundle of mcp/ and runs under plain Node', async () => {
    // @ts-expect-error plain JS build script, no types
    const { bundle, OUT } = (await import('../scripts/build-mcp.mjs')) as { bundle: () => Promise<string>; OUT: string };
    const lf = (s: string) => s.replace(/\r\n/g, '\n');
    expect(lf(readFileSync(OUT, 'utf8')), 'api/mcp.js is stale: run npm run build:mcp').toBe(lf(await bundle()));
    // @ts-expect-error generated bundle, no types
    const mod = (await import('../api/mcp.js')) as { default: { fetch: (r: Request) => Promise<Response> } };
    const res = await mod.default.fetch(
      new Request('https://bkk.example/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'detect_roads', arguments: { ring: SOI38 } } }),
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).result.structuredContent.ok).toBe(true);
  });
});
