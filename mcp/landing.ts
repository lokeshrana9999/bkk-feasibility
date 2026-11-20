// HTML landing page for GET /mcp: what the server is, its tools and scope, how to connect.

import { REPO_URL } from './core';

/** The app's first demo plot (Sukhumvit 38, 40 x 45 m), as [lon, lat] JSON. */
export const SOI38_RING = '[[100.5793403,13.7210608],[100.5793802,13.7207012],[100.5797921,13.7207449],[100.5797522,13.7211045]]';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const TOOLS: [string, string, string][] = [
  ['about', 'none', 'Scope (zone ย.9, 2013 plan), sources and licences, legal readings still to confirm, links'],
  ['find_zone', 'lat, lng', 'Zone code (Thai / Latin), FAR, OSR, in scope or not'],
  ['get_rules', 'zone or lat/lng, building_type', 'Cited rule rows: source, article, Thai quote, English reading'],
  ['detect_roads', 'ring', 'Each plot edge: road / canal / neighbour, measured right-of-way width and gap'],
  ['evaluate_plot', 'ring, building_type, edges?, floor_heights?, near_station?, hotel_rooms?, detail?', 'Rules applied, low- and high-rise envelopes (floors, height, permitted GFA, FAR reached, binding rule), three designs with pass / fail / not-assessed checklists, share link to the 3D app'],
];

export function landingPage(origin: string): string {
  const o = esc(origin);
  const mcp = `${o}/mcp`;
  const ring = SOI38_RING;
  const call = `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"evaluate_plot","arguments":{"ring":${ring},"building_type":"condo"}}}`;
  const desktop = JSON.stringify(
    { mcpServers: { 'bkk-feasibility': { command: 'node', args: ['/path/to/bkk-feasibility/node_modules/tsx/dist/cli.mjs', '/path/to/bkk-feasibility/mcp/stdio.ts'] } } },
    null,
    2,
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bangkok ย.9 feasibility MCP</title>
<meta name="description" content="Public read-only MCP server: Bangkok zone ย.9 building rules, envelopes and designs from a deterministic engine.">
<style>
:root{--bg:#fbfbfa;--fg:#1d1f23;--mut:#5d6370;--line:#e3e4e8;--code:#f1f2f4;--acc:#1f6feb}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--fg:#e6e7ea;--mut:#9aa1ad;--line:#2a2e35;--code:#1b1e23;--acc:#6aa3ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px}
p,li{color:var(--fg)}.mut{color:var(--mut)}a{color:var(--acc)}
pre,code{font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}pre{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto;white-space:pre}
code{background:var(--code);padding:1px 4px;border-radius:4px}pre code{padding:0;background:none}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-top:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}th{color:var(--mut);font-weight:600}
.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:13px;color:var(--mut);margin:4px 4px 0 0}
.note{border-left:3px solid var(--acc);padding:4px 12px;color:var(--mut)}
</style></head><body><main>
<h1>Bangkok ย.9 feasibility, as an MCP server</h1>
<p class="mut">Public, read-only Model Context Protocol server for the same deterministic engine as the <a href="${o}/">web app</a>. Give it a plot in Bangkok zone ย.9 (high-density residential, 2013 city plan) and it returns the cited rules, the buildable envelope under both height regimes, and three designs checked rule by rule.</p>
<span class="pill">Endpoint: ${mcp}</span><span class="pill">Streamable HTTP, stateless, JSON</span><span class="pill">No auth, no keys, no LLM inside</span>

<h2>Connect</h2>
<p>Claude Code:</p>
<pre><code>claude mcp add --transport http bkk-feasibility ${mcp}</code></pre>
<p>Claude Desktop or claude.ai: Settings → Connectors → Add custom connector, URL <code>${mcp}</code>. Any other MCP client: point its streamable HTTP transport at the same URL.</p>
<p>Local, over stdio (same tools, data read from the repo):</p>
<pre><code>git clone ${REPO_URL}
cd bkk-feasibility
npm install
npm run mcp:stdio</code></pre>
<p>Claude Desktop config (<code>claude_desktop_config.json</code>) for the local server:</p>
<pre><code>${esc(desktop)}</code></pre>
<p>Inspect it: <code>npx @modelcontextprotocol/inspector</code>, transport "Streamable HTTP", URL <code>${mcp}</code>.</p>

<h2>Try it with curl</h2>
<pre><code>curl -s ${mcp} -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -s ${mcp} -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \\
  -d '${esc(call)}'</code></pre>
<p class="mut">The ring is a 40 × 45 m plot on Sukhumvit Soi 38: <code>[lon, lat]</code> pairs, longitude first.</p>

<h2>Tools</h2>
<table><tr><th>Tool</th><th>Input</th><th>Returns</th></tr>
${TOOLS.map(([n, i, r]) => `<tr><td><code>${n}</code></td><td>${esc(i)}</td><td>${esc(r)}</td></tr>`).join('\n')}
</table>
<p>Resource <code>rules://y9</code>: the full cited rule table. Prompt <code>feasibility_report</code>: a short report for a plot, using the tools.</p>
<p class="mut">Typical flow: <code>find_zone</code> → <code>detect_roads</code> (check the widths; pass corrections as <code>edges: [{index, role, width, gap}]</code>) → <code>evaluate_plot</code> → open its <code>shareLink</code> to see the plot in 3D.</p>
<p class="mut"><code>shareLink</code> opens the web app on the same plot with the same inputs (edge overrides, station, relief, floor heights, hotel rooms) and so the same figures. Nothing is stored: the whole state sits in the URL after <code>#</code>. A link is given only when the app is checked to rebuild the same inputs from it; otherwise the result says why and what to ask the user. Missing inputs (plot, building type) return <code>needs-detail</code> with the questions to ask, never a guessed default.</p>

<h2>Scope and limits</h2>
<ul>
<li>Zone ย.9 (Y9) of the Bangkok Comprehensive Plan B.E. 2556 only; other zones return a typed <code>outside-scope</code> error naming the zone.</li>
<li>Rules: zoning arts. 16 and 36, Building Control Ordinance B.E. 2544 arts. 49-55, Ministerial Regulations 33 and 55. Where texts differ the stricter reading is applied.</li>
<li>At most 500 corners and 200,000 m² per plot; bad input returns a typed error (<code>too-many-vertices</code>, <code>self-intersection</code>, <code>invalid-override</code>, …).</li>
<li>Rate limit: 60 requests per minute per client.</li>
<li>Data: BMA zoning and right-of-way maps (credit BMA / Department of Lands), OpenStreetMap road names (ODbL).</li>
</ul>
<p class="note">Every result is a feasibility aid, not a legal opinion. Confirm with a licensed Thai architect or the district office.</p>
<p class="mut">Source: <a href="${REPO_URL}">${REPO_URL.replace('https://', '')}</a> · Web app: <a href="${o}/">${o.replace(/^https?:\/\//, '')}</a></p>
</main></body></html>`;
}
