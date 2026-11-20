// Local MCP server over stdio: `npm run mcp:stdio`. Reads the site data from this repo's
// public/data; share links point at the live app (override with BKK_APP_URL).

import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { APP_URL } from './core';
import { SiteData, diskSource, firstOf, httpSource } from './data';
import { createServer } from './server';

const appUrl = (process.env.BKK_APP_URL ?? APP_URL).replace(/\/+$/, '');
const root = fileURLToPath(new URL('../public/data/', import.meta.url));
// local files first; the live deployment's /data if the repo has no data folder
const data = new SiteData(firstOf(diskSource(root), httpSource(`${appUrl}/data/`)));

const server = createServer({ data, appUrl });
await server.connect(new StdioServerTransport());
// stdout carries the protocol; say hello on stderr only
process.stderr.write(`bkk-feasibility MCP server on stdio (data: ${root}, app: ${appUrl})\n`);
