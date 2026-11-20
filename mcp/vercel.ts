// Vercel function entry, bundled to api/mcp.js by `npm run build:mcp` (scripts/build-mcp.mjs).
// /mcp is rewritten here (vercel.json). Site data: public/data bundled with the function
// (vercel.json includeFiles), else the deployment's own /data over HTTP.

import path from 'node:path';
import { SiteData, diskSource, firstOf, httpSource, type Source } from './data';
import { createHandler, originOf } from './http';

let origin: string | null = null;
const selfHttp: Source = (rel) => (origin ? httpSource(`${origin}/data/`)(rel) : Promise.resolve(null));
const data = new SiteData(firstOf(diskSource(path.join(process.cwd(), 'public', 'data')), selfHttp));
const handle = createHandler({ data });

export default {
  async fetch(req: Request): Promise<Response> {
    origin = originOf(req);
    return handle(req);
  },
};
