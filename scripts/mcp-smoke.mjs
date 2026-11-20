// Smoke test of a running MCP endpoint (vercel dev, a preview or production):
//   node scripts/mcp-smoke.mjs https://bkk-feasibility.vercel.app/mcp
// Checks the landing page, initialize, tools/list, every tool, the resource and a typed error.

const url = process.argv[2] ?? 'http://localhost:3000/mcp';
const RING = [[100.5793403, 13.7210608], [100.5793802, 13.7207012], [100.5797921, 13.7207449], [100.5797522, 13.7211045]];
let id = 0;
let failed = 0;

async function rpc(method, params = {}) {
  const t = Date.now();
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const body = await r.json();
  return { status: r.status, body, ms: Date.now() - t };
}

function check(name, ok, info = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? `  (${info})` : ''}`);
  if (!ok) failed++;
}

const page = await fetch(url, { headers: { Accept: 'text/html' } });
const html = await page.text();
check('GET landing page', page.status === 200 && html.includes('claude mcp add'), `${page.status}`);

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
check('initialize', init.body.result?.serverInfo?.name === 'bkk-feasibility', `${init.ms} ms`);

const list = await rpc('tools/list');
const names = (list.body.result?.tools ?? []).map((t) => t.name).sort().join(',');
check('tools/list', names === 'about,detect_roads,evaluate_plot,find_zone,get_rules,list_zones,search_place', names);

const call = async (name, args) => {
  const r = await rpc('tools/call', { name, arguments: args });
  return { v: r.body.result?.structuredContent, isError: r.body.result?.isError, ms: r.ms };
};
let c = await call('about', {});
check('about', c.v?.ok === true, `${c.ms} ms, app ${c.v?.links?.app}`);
c = await call('list_zones', {});
check('list_zones', c.v?.count === 31, `${c.ms} ms, ${c.v?.count} zones`);
c = await call('search_place', { query: 'Sukhumvit 38' });
check('search_place', c.v?.results?.[0]?.inScope === true, `${c.ms} ms, ${c.v?.results?.[0]?.name} ${c.v?.results?.[0]?.zone?.codeLatin}`);
c = await call('find_zone', { lat: 13.72092, lng: 100.57957 });
check('find_zone', c.v?.zone?.code === 'ย.๙-๒๓', `${c.ms} ms`);
c = await call('get_rules', { zone: 'Y9-23', building_type: 'condo' });
check('get_rules', c.v?.rules?.length > 10, `${c.ms} ms, ${c.v?.rules?.length} rows`);
c = await call('detect_roads', { ring: RING });
check('detect_roads', c.v?.ok === true && c.v.roads.length > 0, `${c.ms} ms, roads ${JSON.stringify(c.v?.roads?.map((r) => r.widthM))}`);
c = await call('evaluate_plot', { ring: RING, building_type: 'condo' });
check('evaluate_plot', c.v?.ok === true, `${c.ms} ms, ${c.v?.headline}`);
console.log(`     share link: ${c.v?.shareLink}`);
c = await call('evaluate_plot', { ring: RING.slice(0, 2), building_type: 'condo' });
check('typed error', c.isError === true && c.v?.code === 'too-few-points', c.v?.code);
const res = await rpc('resources/read', { uri: 'rules://y9' });
check('rules://y9', JSON.parse(res.body.result?.contents?.[0]?.text ?? '{}').rules?.length === 23);

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
