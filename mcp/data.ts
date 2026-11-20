// Site data for the MCP server: the same static files the web app loads from /data, read from
// disk (bundled with the function, or the repo when run locally) and, failing that, fetched from
// the deployment's own /data path. Parsed with the app's parsers (src/site/parse.ts).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Area, RowFeature, ZonePoly } from '../src/site/data';
import { otherZones, roadNameMap, toRows, toZones, type FC } from '../src/site/parse';

/** Reads one data file by its path under /data (eg "row/82.json"); null when it is missing. */
export type Source = (rel: string) => Promise<unknown | null>;

const SAFE = /^[a-z0-9_]+(\/[a-z0-9_]+)*\.json$/i;

export function diskSource(root: string): Source {
  return async (rel) => {
    if (!SAFE.test(rel)) return null;
    try {
      return JSON.parse(await readFile(path.join(root, rel), 'utf8'));
    } catch {
      return null;
    }
  };
}

export function httpSource(base: string): Source {
  return async (rel) => {
    if (!SAFE.test(rel)) return null;
    try {
      const r = await fetch(new URL(rel, base.endsWith('/') ? base : `${base}/`), { signal: AbortSignal.timeout(8000) });
      if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return null;
      return await r.json();
    } catch {
      return null;
    }
  };
}

/** First source that has the file wins. */
export const firstOf =
  (...sources: Source[]): Source =>
  async (rel) => {
    for (const s of sources) {
      const v = await s(rel);
      if (v !== null) return v;
    }
    return null;
  };

export class DataUnavailable extends Error {
  constructor(what: string) {
    super(`site data unavailable: ${what}`);
  }
}

/** Lazily loaded, cached site data. One instance per process (warm function instances reuse it). */
export class SiteData {
  private areasP: Promise<Area[]> | null = null;
  private y9P: Promise<ZonePoly[]> | null = null;
  private allP: Promise<ZonePoly[]> | null = null;
  private rows = new Map<number, Promise<RowFeature[]>>();
  private names = new Map<number, Promise<Map<string, string>>>();

  constructor(private src: Source) {}

  private need<T>(rel: string, parse: (j: never) => T): Promise<T> {
    return this.src(rel).then((j) => {
      if (j === null) throw new DataUnavailable(rel);
      return parse(j as never);
    });
  }

  /** Retry on the next call after a failure instead of caching the rejection. */
  private keep<T>(get: () => Promise<T> | null, set: (p: Promise<T> | null) => void, make: () => Promise<T>): Promise<T> {
    let p = get();
    if (!p) {
      p = make().catch((e) => {
        set(null);
        throw e;
      });
      set(p);
    }
    return p;
  }

  areas(): Promise<Area[]> {
    return this.keep(() => this.areasP, (p) => (this.areasP = p), () => this.need('areas.json', (j: { areas: Area[] }) => j.areas ?? []));
  }

  zonesY9(): Promise<ZonePoly[]> {
    return this.keep(() => this.y9P, (p) => (this.y9P = p), () => this.need('zones_y9.json', (fc: FC) => toZones(fc, true)));
  }

  /** City-plan zones outside ย.9. */
  zonesOther(): Promise<ZonePoly[]> {
    return this.keep(() => this.allP, (p) => (this.allP = p), () => this.need('zones_all.json', (fc: FC) => otherZones(fc)));
  }

  rowsOf(area: Area): Promise<RowFeature[]> {
    let p = this.rows.get(area.id);
    if (!p) {
      p = this.need(area.files.row ?? `row/${area.id}.json`, (fc: FC) => toRows(fc)).catch((e) => {
        this.rows.delete(area.id);
        throw e;
      });
      this.rows.set(area.id, p);
    }
    return p;
  }

  /** English road names; empty when the file is missing (labels are a nicety). */
  roadNamesOf(area: Area): Promise<Map<string, string>> {
    let p = this.names.get(area.id);
    if (!p) {
      p = this.src(area.files.roads ?? `roads/${area.id}.json`).then((j) => roadNameMap(j as FC | null));
      this.names.set(area.id, p);
    }
    return p;
  }
}
