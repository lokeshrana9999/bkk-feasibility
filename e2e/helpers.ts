// Shared helpers for the e2e suite: open the app with a plot, wait for the engine, read the panel,
// reach the MapLibre map (via React's fiber, the production build does not expose it) and drive it.
import { expect, type Page, type ConsoleMessage } from '@playwright/test';

export type LL = [number, number];

// ---- local metres <-> lon/lat (same series as src/site/geo.ts makeFrame)
export function frame(lon0: number, lat0: number) {
  const p = (lat0 * Math.PI) / 180;
  const ky = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p);
  const kx = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p);
  return { toLL: (x: number, y: number): LL => [lon0 + x / kx, lat0 + y / ky], kx, ky };
}
/** Ring from local metre points around an origin. */
export const ringAt = (origin: LL, pts: [number, number][]): LL[] => {
  const f = frame(origin[0], origin[1]);
  return pts.map(([x, y]) => f.toLL(x, y));
};
export const hashOf = (ring: LL[], type = 'condo') =>
  `#p=${ring.map((q) => `${q[0].toFixed(7)},${q[1].toFixed(7)}`).join(';')}&t=${type}`;

// Spots found by e2e/tools/find-spot.ts: inside ย.9-23 (FAR 7, OSR 4.5%), no right-of-way within 3 m
// of a 50 x 40 m rectangle at the origin.
// (The first spot, 100.5775848 13.7171633, has a soi through its interior: once the app cut the
// right-of-way out of plots (F01) it stopped being a clean 2,000 m2 plot. find-spot now checks the
// interior too.)
export const EMPTY_Y923: LL = [100.5809427, 13.7136105];
export const EMPTY_Y923_B: LL = [100.5748612, 13.7198373];

// ---- console / network watch
export interface Watch { errors: string[]; warnings: string[]; failed: string[] }
export function watch(page: Page): Watch {
  const w: Watch = { errors: [], warnings: [], failed: [] };
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') w.errors.push(m.text());
    if (m.type() === 'warning') w.warnings.push(m.text());
  });
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => w.failed.push(`${r.failure()?.errorText} ${r.url()}`));
  page.on('response', (r) => {
    if (r.status() >= 400) w.failed.push(`${r.status()} ${r.url()}`);
  });
  return w;
}

// ---- open + wait
export async function open(page: Page, hash = '') {
  await page.goto(`/${hash}`);
  await page.waitForSelector('.panel');
  await waitMap(page);
}

export async function waitMap(page: Page) {
  await page.waitForFunction(() => !!(window as any).__e2eMapReady || !!document.querySelector('.maplibregl-canvas'), null, { timeout: 30_000 });
  await installMapHook(page);
  await page.waitForFunction(() => {
    const m = (window as any).__e2eMap;
    return m && m.loaded && m.isStyleLoaded !== undefined;
  }, null, { timeout: 30_000 });
}

/** Finds the maplibre Map instance through React's fiber tree and stores it as window.__e2eMap. */
export async function installMapHook(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.map') as any;
    if (!el) return false;
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    let f = key ? el[key] : null;
    while (f) {
      let s = f.memoizedState;
      while (s && typeof s === 'object' && 'next' in s) {
        const v = s.memoizedState;
        if (v && v.current && typeof v.current.project === 'function' && typeof v.current.getCanvas === 'function') {
          (window as any).__e2eMap = v.current;
          return true;
        }
        s = s.next;
      }
      f = f.return;
    }
    return false;
  }, null, { timeout: 30_000 });
}

/** Waits until the panel shows a settled engine result (or an error / outside banner). */
export async function settle(page: Page, timeout = 30_000) {
  await page.waitForFunction(
    () => {
      const aside = document.querySelector('.summary .aside')?.textContent ?? '';
      const err = document.querySelector('.panel .banner.err, .panel .banner.info');
      const loading = document.querySelector('.map-status');
      return !loading && ((aside.includes('computed') && !aside.includes('updating')) || !!err);
    },
    null,
    { timeout },
  );
  await page.waitForTimeout(150);
}

export interface Kpis {
  permitted: number; farCap: number | null; far: number; height: number; floors: number; regime: string; limitedBy: string; ms: number | null; regimeLine: string;
}
const num = (s: string | undefined | null) => (s ? Number(s.replace(/[^\d.\-]/g, '')) : NaN);

export async function kpis(page: Page): Promise<Kpis> {
  return page.evaluate(() => {
    const k = [...document.querySelectorAll('.summary .kpi')].map((e) => ({
      k: e.querySelector('span')?.textContent ?? '', v: e.querySelector('b')?.textContent ?? '', s: e.querySelector('small')?.textContent ?? '',
    }));
    const get = (name: string) => k.find((x) => x.k.startsWith(name));
    const n = (s?: string) => (s ? Number(s.replace(/[^\d.\-]/g, '')) : NaN);
    const aside = document.querySelector('.summary .aside')?.textContent ?? '';
    return {
      permitted: n(get('Permitted')?.v),
      farCap: get('Permitted')?.s ? n(get('Permitted')!.s) : null,
      far: n(get('FAR')?.v),
      height: n(get('Height')?.v),
      floors: n(get('Height')?.s),
      regime: get('Regime')?.v ?? '',
      limitedBy: document.querySelector('.summary .limit')?.textContent ?? '',
      ms: /(\d[\d,]*) ms/.test(aside) ? Number(aside.match(/(\d[\d,]*) ms/)![1]!.replace(/,/g, '')) : null,
      regimeLine: document.querySelector('.summary .sub')?.textContent ?? '',
    };
  });
}

export interface DesignCard { name: string; meta: string; passes: boolean; gfa: number; far: number; footprint: number; open: number }
export async function designs(page: Page): Promise<DesignCard[]> {
  const raw = await page.$$eval('.dcard', (cs) =>
    cs.map((c) => ({
      name: c.querySelector('.dt b')?.textContent ?? '',
      meta: c.querySelector('.dt small')?.textContent ?? '',
      pill: c.querySelector('.pill')?.textContent ?? '',
      dk: [...c.querySelectorAll('.dk span')].map((s) => s.childNodes[1]?.textContent ?? ''),
    })),
  );
  return raw.map((d) => ({ name: d.name, meta: d.meta, passes: d.pill === 'passes', gfa: num(d.dk[0]), far: num(d.dk[1]), footprint: num(d.dk[2]), open: num(d.dk[3]) }));
}

export async function plotFacts(page: Page) {
  return page.$$eval('.plot-facts .fact', (fs) => Object.fromEntries(fs.map((f) => [f.querySelector('span')?.textContent ?? '', f.querySelector('b')?.textContent ?? ''])));
}

export async function edgeRows(page: Page) {
  return page.$$eval('.edges .edge', (rs) =>
    rs.map((r) => ({
      len: Number((r.querySelector('.elen')?.textContent ?? '').replace(/[^\d.]/g, '')),
      role: (r.querySelector('.chip.on')?.textContent ?? '').toLowerCase(),
      width: (r.querySelector('.win') as HTMLInputElement | null)?.value ?? null,
      tags: [...r.querySelectorAll('.esrc .tag, .esrc .ename, .esrc .link')].map((t) => t.textContent ?? ''),
    })),
  );
}

/** Marks edge i (0-based) as a road of the given width, through the panel. */
export async function setRoad(page: Page, i: number, width: number | string, role: 'Road' | 'Canal' = 'Road') {
  const row = page.locator('.edges .edge').nth(i);
  await row.locator('.chip', { hasText: role }).click();
  const inp = row.locator('.win');
  await inp.fill(String(width));
  await inp.blur();
}

export async function setType(page: Page, label: 'Condo' | 'Apartment' | 'Office' | 'Hotel') {
  await page.locator('.seg button', { hasText: label }).first().click();
}

// ---- map geometry
export async function project(page: Page, p: LL): Promise<[number, number]> {
  const xy = await page.evaluate((q) => {
    const m = (window as any).__e2eMap;
    const pt = m.project(q);
    const r = m.getCanvas().getBoundingClientRect();
    return [pt.x + r.left, pt.y + r.top];
  }, p);
  return xy as [number, number];
}

/** Puts the camera straight above a point (no pitch, no bearing), at a zoom, and waits for idle. */
export async function topDown(page: Page, center: LL, zoom = 18) {
  await page.evaluate(
    ([c, z]) =>
      new Promise<void>((res) => {
        const m = (window as any).__e2eMap;
        m.jumpTo({ center: c, zoom: z, pitch: 0, bearing: 0 });
        if (m.loaded()) setTimeout(res, 200);
        else m.once('idle', () => res());
        setTimeout(res, 3000);
      }),
    [center, zoom] as const,
  );
}

/** Draws a plot by clicking its corners in Draw mode (the camera must show them). */
export async function drawRing(page: Page, ring: LL[]) {
  await page.locator('.ph ~ * button.btn.primary, button.btn.primary').first().click();
  await expect(page.locator('.map-hint')).toContainText('Click to place corners');
  for (const p of ring) {
    const [x, y] = await project(page, p);
    await page.mouse.click(x, y);
    await page.waitForTimeout(120);
  }
  const [x, y] = await project(page, ring[0]!);
  await page.mouse.click(x, y);
  await page.waitForTimeout(300);
}

export async function drag(page: Page, from: LL, to: LL) {
  const [x0, y0] = await project(page, from);
  const [x1, y1] = await project(page, to);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(x0 + ((x1 - x0) * k) / 10, y0 + ((y1 - y0) * k) / 10);
  await page.mouse.up();
}

export const shot = (name: string) => `e2e/screenshots/${name}.png`;

/** Saves e2e/screenshots/<id>.png when E2E_EVIDENCE=1 (refreshes the screenshots FINDINGS.md links). */
export async function evidence(page: Page, id: string) {
  if (process.env.E2E_EVIDENCE) await page.screenshot({ path: shot(id) });
}
