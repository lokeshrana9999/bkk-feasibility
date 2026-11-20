// The MCP server: tools, the rule-table resource and the report prompt, wrapping mcp/core.ts.
// Transport-free; mcp/http.ts (streamable HTTP, stateless) and mcp/stdio.ts connect it.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { about, brief, detectRoads, evaluatePlot, findZone, getRules, ruleTable, type Ctx, TYPES, MAX_VERTICES } from './core';

export const SERVER_NAME = 'bkk-feasibility';
export const SERVER_VERSION = '1.0.0';

const INSTRUCTIONS = `Bangkok zone ย.9 (Y9) building feasibility, read-only and deterministic (no LLM inside).
Typical flow: find_zone(lat, lng) to check the site is in ย.9 -> detect_roads(ring) to see which plot edges face a road and how wide it is -> evaluate_plot(ring, building_type) for the rules, the low- and high-rise envelopes, three designs with rule checklists and a share link that opens the plot in the 3D web app.
Rings are [lon, lat] pairs (longitude first), at most ${MAX_VERTICES} corners and 200,000 m2. Every result is a feasibility aid, not a legal opinion; say so when you report it.
Never guess a plot location, corners, road widths or the building type. If you lack one, call the tool without it: it answers code "needs-detail" with askUser questions. Put those questions (and any askUser / checkWithUser items in other results) to the user, then call again.
Only share app links the tools return (shareLink, appLink). When a link is null, the result says why and what to ask; never build an app URL yourself.`;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const ring = z
  .array(z.array(z.number()).describe('[lon, lat] in decimal degrees, longitude first (or [x, y] metres with units "m")'))
  .max(5000)
  .optional()
  .describe(`Plot outline: [lon, lat] corners, open or closed, 3-${MAX_VERTICES} corners, at most 200,000 m2. If you do not have the corners, omit it: the tool says what to ask the user`);
const buildingType = z.enum(TYPES).optional().describe('condo | apartment | office | hotel. Ask the user if unknown; omit rather than guess and the tool says what to ask');

function result(v: { ok: boolean }): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(v, null, 1) }],
    structuredContent: v as unknown as Record<string, unknown>,
    ...(v.ok ? {} : { isError: true }),
  };
}

export function createServer(ctx: Ctx): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION, title: 'Bangkok ย.9 feasibility' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'about',
    {
      title: 'About this server',
      description: 'What the engine does, its scope (Bangkok zone ย.9, 2013 plan), sources and licences, the legal readings still to confirm, and links to the web app and repo.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => result(about(ctx)),
  );

  server.registerTool(
    'find_zone',
    {
      title: 'Find the zone of a point',
      description: 'Zone of the Bangkok comprehensive plan at a point: zone code (Thai and Latin), FAR, OSR, and whether it is in this tool\'s scope (ย.9).',
      inputSchema: {
        lat: z.number().describe('Latitude, decimal degrees (Bangkok is about 13.7)'),
        lng: z.number().describe('Longitude, decimal degrees (Bangkok is about 100.5)'),
      },
      annotations: READ_ONLY,
    },
    async ({ lat, lng }) => result(await findZone(ctx, lat, lng)),
  );

  server.registerTool(
    'get_rules',
    {
      title: 'Rules for a zone and building type',
      description: 'The cited rule rows (source, article, Thai quote, English reading, kind) that apply to a building type in a ย.9 zone, with the zone\'s FAR and OSR. Give zone, or lat and lng.',
      inputSchema: {
        zone: z.string().max(40).optional().describe('ย.9 sub-zone code, eg "ย.๙-๒๓" or "Y9-23"'),
        lat: z.number().optional().describe('Latitude, instead of zone'),
        lng: z.number().optional().describe('Longitude, instead of zone'),
        building_type: buildingType,
      },
      annotations: READ_ONLY,
    },
    async ({ zone, lat, lng, building_type }) => result(await getRules(ctx, { zone, lat, lng, buildingType: building_type })),
  );

  server.registerTool(
    'detect_roads',
    {
      title: 'Detect roads along a plot',
      description:
        'For each edge of a plot in ย.9: road, canal or neighbour, from the city right-of-way map, with the measured right-of-way width and the gap to it. The plot is first snapped to a road within 1.5 m and any part on the right-of-way is cut away; edge indices refer to that buildable outline (buildableRing) and are the ones evaluate_plot takes as overrides.',
      inputSchema: { ring },
      annotations: READ_ONLY,
    },
    async ({ ring }) => result(await detectRoads(ctx, ring)),
  );

  server.registerTool(
    'evaluate_plot',
    {
      title: 'Evaluate a plot',
      description:
        'Full feasibility of a plot: the rules applied with their values, both regimes (low-rise and high-rise: floors, height, permitted floor area, FAR reached, binding rule), three designs with pass / fail / not-assessed checklists, and shareLink: a web-app URL that opens the plot in 3D with the same inputs, given only when the app is checked to rebuild the same inputs from it (otherwise shareLinkUnavailable says why and what to ask). Roads are detected from the city map; correct them with edges overrides (indices from detect_roads). With units "m" the ring is in metres (an abstract plot, no link): give zone and the road edges yourself. Missing inputs return needs-detail with the questions to ask the user.',
      inputSchema: {
        ring,
        building_type: buildingType,
        edges: z
          .array(
            z.object({
              index: z.number().int().describe('Edge index (edge i runs from corner i to corner i+1), as listed by detect_roads'),
              role: z.enum(['road', 'canal', 'private']).describe('road | canal | private (a neighbour\'s land)'),
              width: z.number().optional().describe('Right-of-way width in metres (road or canal), 1-100'),
              gap: z.number().optional().describe('Metres between the plot edge and the right-of-way, 0-50'),
              name: z.string().max(80).optional().describe('Road name (units "m" only): edges with different names are different roads'),
            }),
          )
          .max(MAX_VERTICES)
          .optional()
          .describe('Per-edge overrides of the detected roads; edges not listed keep the detection'),
        units: z.enum(['lonlat', 'm']).optional().describe('lonlat (default): a real plot on the map. m: an abstract plot in metres'),
        zone: z.string().max(40).optional().describe('ย.9 zone code, units "m" only (eg "Y9-23")'),
        near_station: z.boolean().optional().describe('Within 500 m of a mass-transit station (waives the zoning road gates for hotels and offices). Default false'),
        wider_road_relief: z.boolean().optional().describe('Apply MR 55 arts. 45-46 wider-road relief on corner / two-road plots. Default true'),
        floor_heights: z
          .object({ ground: z.number().describe('Ground floor-to-floor height, m (2.4-10)'), typical: z.number().describe('Typical floor-to-floor height, m (2.4-10)') })
          .optional()
          .describe('Default per building type: 4.5 m ground, 3.0 m typical (office 3.8 m)'),
        hotel_rooms: z.number().int().optional().describe('Hotel room count, for the 80-room gate (default: 50 m2 of floor area per room)'),
        detail: z.enum(['brief', 'full']).optional().describe('brief (default): no per-floor tables or passing checks. full: everything'),
      },
      annotations: READ_ONLY,
    },
    async (a) => {
      const r = await evaluatePlot(ctx, {
        ring: a.ring,
        units: a.units,
        buildingType: a.building_type,
        edges: a.edges,
        zone: a.zone,
        nearStation: a.near_station,
        widerRoadRelief: a.wider_road_relief,
        floorHeights: a.floor_heights,
        hotelRooms: a.hotel_rooms,
      });
      return result(r.ok && a.detail !== 'full' ? brief(r) : r);
    },
  );

  server.registerResource(
    'rule-table',
    'rules://y9',
    {
      title: 'ย.9 rule table',
      description: 'Every rule row the engine applies, with source document, article, Thai quote and English reading, plus the per-type parameters.',
      mimeType: 'application/json',
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(ruleTable(), null, 1) }] }),
  );

  server.registerPrompt(
    'feasibility_report',
    {
      title: 'Feasibility report for a plot',
      description: 'Write a short feasibility report for a Bangkok plot using this server\'s tools.',
      argsSchema: {
        plot: z.string().describe('The plot: a JSON ring of [lon, lat] corners, or a lat,lng point with the plot size'),
        building_type: z.string().optional().describe('condo, apartment, office or hotel (default condo)'),
      },
    },
    ({ plot, building_type }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Write a short feasibility report for this Bangkok plot: ${plot}
Building type: ${building_type || 'condo'}.

Use the bkk-feasibility tools:
1. If you only have a point, call find_zone, and if it is in ย.9, draw a ring of [lon, lat] corners for the plot around it (longitude first).
2. Call detect_roads with the ring and list each road edge with its width. If a width looks wrong, say so and pass a correction in step 3.
3. Call evaluate_plot with the ring and building type.

Report in under 300 words: zone, FAR and OSR; the chosen regime with permitted floor area, floors, height and the binding rule; why the other regime is or is not allowed; the designs and which rules they fail or could not assess; the key setbacks with their articles. End with the share link and the disclaimer that this is a feasibility aid, not a legal opinion.`,
          },
        },
      ],
    }),
  );

  return server;
}
