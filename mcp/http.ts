// Streamable HTTP endpoint (MCP 2025-03-26+), stateless: every POST gets a fresh server and
// transport and a plain JSON answer, so it runs on any serverless instance. GET serves a landing
// page for browsers. Web-standard Request -> Response, so the same handler runs on Vercel, in a
// Node harness and in the tests. Domain-agnostic: links are built from the request's own host.

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { SiteData } from './data';
import { landingPage } from './landing';
import { createServer } from './server';

export const MAX_BODY = 256 * 1024;

export interface HttpOptions {
  data: SiteData;
  /** Requests per IP per window (default 60 per minute). */
  rateLimit?: { max: number; windowMs: number };
  /** Fixed app origin; default: the request's own origin. */
  appUrl?: string;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID, Authorization',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

const rpcError = (status: number, code: number, message: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });

/** Origin of this deployment, from the forwarded host (Vercel) or the URL. */
export function originOf(req: Request): string {
  const u = new URL(req.url);
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? u.host).split(',')[0]!.trim();
  const proto = (req.headers.get('x-forwarded-proto') ?? u.protocol.replace(':', '')).split(',')[0]!.trim();
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host) || !/^https?$/.test(proto)) return u.origin;
  return `${proto}://${host}`;
}

function clientIp(req: Request): string {
  const h = req.headers;
  return (h.get('x-real-ip') ?? h.get('x-vercel-forwarded-for') ?? h.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim();
}

/** Fixed-window counter per IP, per instance (best effort: serverless instances do not share it). */
export class RateLimiter {
  private hits = new Map<string, { n: number; t0: number }>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  /** Seconds to wait, or 0 when the request may go ahead. */
  take(ip: string, now = Date.now()): number {
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (now - v.t0 >= this.windowMs) this.hits.delete(k);
    const e = this.hits.get(ip);
    if (!e || now - e.t0 >= this.windowMs) {
      this.hits.set(ip, { n: 1, t0: now });
      return 0;
    }
    if (e.n >= this.max) return Math.max(1, Math.ceil((e.t0 + this.windowMs - now) / 1000));
    e.n++;
    return 0;
  }
}

export function createHandler(opts: HttpOptions): (req: Request) => Promise<Response> {
  const rl = opts.rateLimit ?? { max: 60, windowMs: 60_000 };
  const limiter = new RateLimiter(rl.max, rl.windowMs);

  return async (req) => {
    const origin = opts.appUrl ?? originOf(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (req.method === 'GET' || req.method === 'HEAD') {
      const accept = req.headers.get('accept') ?? '';
      // an MCP client asking for a server-sent event stream: none in stateless mode
      if (accept.includes('text/event-stream') && !accept.includes('text/html')) {
        return rpcError(405, -32000, 'Method not allowed: this server is stateless; send JSON-RPC with POST.', { Allow: 'POST, OPTIONS' });
      }
      return new Response(req.method === 'HEAD' ? null : landingPage(origin), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', ...CORS },
      });
    }

    if (req.method !== 'POST') return rpcError(405, -32000, 'Method not allowed: use POST for JSON-RPC, GET for the landing page.', { Allow: 'GET, POST, OPTIONS' });

    const wait = limiter.take(clientIp(req));
    if (wait > 0) return rpcError(429, -32000, `Rate limit: at most ${rl.max} requests per ${rl.windowMs / 1000} s per client. Retry in ${wait} s.`, { 'Retry-After': String(wait) });

    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > MAX_BODY) return rpcError(413, -32600, `Request body over ${MAX_BODY / 1024} KB.`);
    const body = await req.text();
    if (body.length > MAX_BODY) return rpcError(413, -32600, `Request body over ${MAX_BODY / 1024} KB.`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return rpcError(400, -32700, 'Parse error: the body is not valid JSON.');
    }

    // be lenient with hand-written clients (curl): accept JSON without the SSE accept type
    const headers = new Headers(req.headers);
    const accept = headers.get('accept') ?? '';
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) headers.set('accept', 'application/json, text/event-stream');
    if (!(headers.get('content-type') ?? '').includes('application/json')) headers.set('content-type', 'application/json');
    const fwd = new Request(req.url, { method: 'POST', headers, body });

    const server = createServer({ data: opts.data, appUrl: origin });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      const res = await transport.handleRequest(fwd, { parsedBody: parsed });
      const out = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS)) out.set(k, v);
      const text = await res.text();
      return new Response(text || null, { status: res.status, headers: out });
    } catch (e) {
      return rpcError(500, -32603, `Internal error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      void server.close().catch(() => {});
    }
  };
}
