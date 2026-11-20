# Bangkok ย.9 plot feasibility

Draw a plot in Bangkok zone ย.9 and see the cited rules, the buildable 3D envelope and designs among real buildings: <https://bkk-feasibility.vercel.app>. A deterministic TypeScript engine (`src/engine/`, see `ENGINE-NOTES.md`) computes everything; the web app and the MCP server below call the same code.

## MCP server

The engine is also a public, read-only [Model Context Protocol](https://modelcontextprotocol.io) server, so an agent can ask "what can I build on this plot?" and get the web app's numbers. No auth, no keys, no LLM inside; every result says it is a feasibility aid, not a legal opinion.

- Endpoint: `https://bkk-feasibility.vercel.app/mcp` (streamable HTTP, stateless, JSON responses). Open it in a browser for a landing page with the same setup notes.
- Code: `mcp/` (tools in `mcp/core.ts`, MCP wiring in `mcp/server.ts`, HTTP in `mcp/http.ts`), bundled to `api/mcp.js` for Vercel.

### Tools

| Tool | Input | Returns |
|---|---|---|
| `about` | none | scope (zone ย.9, 2013 plan), sources and licences, legal readings still to confirm, links |
| `find_zone` | `lat`, `lng` | zone code (Thai / Latin), FAR, OSR, in scope or not |
| `get_rules` | `zone` (eg `Y9-23`) or `lat`/`lng`, `building_type` | cited rule rows: source, article, Thai quote, English reading |
| `detect_roads` | `ring` | each plot edge: road / canal / neighbour, measured right-of-way width and gap |
| `evaluate_plot` | `ring`, `building_type`, optional `edges` overrides, `floor_heights`, `near_station`, `wider_road_relief`, `hotel_rooms`, `detail` | rules applied, both regimes (floors, height, permitted GFA, FAR reached, binding rule), three designs with pass / fail / not-assessed checklists, `shareLink` that opens the plot in the 3D app |

Also: resource `rules://y9` (the full cited rule table) and prompt `feasibility_report`.

Rings are `[lon, lat]` pairs, longitude first, open or closed, 3-500 corners, at most 200,000 m². Edge overrides use the edge indices `detect_roads` lists: `edges: [{ "index": 0, "role": "road", "width": 12, "gap": 0 }]`. `units: "m"` evaluates an abstract plot in metres (give `zone` and the road edges yourself; no share link). Bad input returns a typed error (`too-few-points`, `too-many-vertices`, `too-large`, `self-intersection`, `invalid-override`, `outside-scope` with the zone found, ...). Rate limit: 60 requests per minute per client (per function instance).

### Open the result in the 3D app

`evaluate_plot` returns `shareLink`, a web-app URL that opens the plot in 3D with the same inputs and so the same figures. No database: the whole state is in the URL fragment, in the app's own share format (`#p=lon,lat;...&t=type&e=edge overrides&s=station&rl=relief&fh=floor heights&hr=hotel rooms`), and the app rebuilds everything from it. The MCP evaluates the outline rounded to 7 decimals (about 1 cm), exactly as the link writes it, so the app and the MCP compute from the same corners; `test-mcp` checks the link alone reproduces each evaluation. `detect_roads` also returns an `appLink` (condo, detected roads).

A link is handed out only when it is possible: before returning it, the server reads it back the way the app does and checks it yields the very inputs it evaluated (outline, type, edge overrides, station, relief, floor heights, hotel rooms). Otherwise the field is `null` and `shareLinkUnavailable` gives the reason, the questions to ask the user and what to do next. A plot given in metres, for example, has no place on the map, so the agent is told to ask where the plot is and call again with `[lon, lat]` corners.

### Asking instead of guessing

When an input that decides the result is missing (the plot, the building type, the zone of a metres plot, the site for `get_rules`), the tool answers `code: "needs-detail"` with `missing` and `askUser` questions instead of assuming a default. Every typed error carries `then` (what to do next) and, where only the user can fix it (crossing outline, plot outside ย.9, too few corners), `askUser`. A successful `evaluate_plot` adds `checkWithUser` when the result turns on map facts worth confirming: no road along any side, a large part of the outline cut away as right-of-way, or a plot split between zones.

### Connect

Claude Code:

```
claude mcp add --transport http bkk-feasibility https://bkk-feasibility.vercel.app/mcp
```

Claude Desktop or claude.ai: Settings → Connectors → Add custom connector, URL `https://bkk-feasibility.vercel.app/mcp`.

Local, over stdio (same tools, data read from this repo's `public/data`):

```
git clone https://github.com/lokeshrana9999/bkk-feasibility
cd bkk-feasibility
npm install
npm run mcp:stdio
```

Claude Desktop config (`claude_desktop_config.json`) for the local server; `node` + `tsx` directly, so nothing but the protocol reaches stdout:

```json
{
  "mcpServers": {
    "bkk-feasibility": {
      "command": "node",
      "args": ["/path/to/bkk-feasibility/node_modules/tsx/dist/cli.mjs", "/path/to/bkk-feasibility/mcp/stdio.ts"]
    }
  }
}
```

Claude Code, local: `claude mcp add bkk-local -- npx tsx /path/to/bkk-feasibility/mcp/stdio.ts`. Share links from the local server point at the live app; set `BKK_APP_URL` to change that.

MCP Inspector: `npx @modelcontextprotocol/inspector`, transport "Streamable HTTP", URL `https://bkk-feasibility.vercel.app/mcp` (or command `npx tsx mcp/stdio.ts` for stdio).

### curl

```
curl -s https://bkk-feasibility.vercel.app/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -s https://bkk-feasibility.vercel.app/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"evaluate_plot","arguments":{"ring":[[100.5793403,13.7210608],[100.5793802,13.7207012],[100.5797921,13.7207449],[100.5797522,13.7211045]],"building_type":"condo"}}}'
```

The ring is the app's first demo plot, 40 × 45 m on Sukhumvit Soi 38 (expected: high-rise, 12,554 m² permitted, FAR 7.00, 31 floors).

### Develop

| Command | What |
|---|---|
| `npm run test:mcp` | JSON-RPC tests through the HTTP handler (every tool, typed errors, G1 equals the engine, rate limit, landing page), the stdio entry, and a check that `api/mcp.js` is the current bundle |
| `npm run build:mcp` | rebundle `mcp/` into `api/mcp.js` after changing `mcp/`, `src/engine/` or `src/site/` (the bundle is committed; the test above fails when it is stale) |
| `npm run typecheck:mcp` | typecheck `mcp/` and its tests |
| `node scripts/mcp-smoke.mjs <url>` | smoke test a running endpoint (`vercel dev`, a preview or production) |

The function is domain-agnostic: links in results and on the landing page use the request's own host, so any domain aliased to the project serves the same server at `/mcp`.
