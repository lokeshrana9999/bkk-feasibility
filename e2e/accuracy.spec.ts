// Accuracy: golden plots drawn on the live map (as lon/lat through the share link, roads marked in
// the edge table) must show the numbers the engine computes in metres and the hand-derived values
// in test/golden.test.ts. Tolerance: the 15 mm safety margin plus the lon/lat projection (< 0.05%).
import { test, expect, type Page } from '@playwright/test';
import { evaluate } from '../src/engine/index';
import type { EngineInput } from '../src/engine/index';
import { open, settle, kpis, designs, ringAt, hashOf, EMPTY_Y923, setRoad, plotFacts } from './helpers';

const RECT_M: [number, number][] = [[0, 0], [50, 0], [50, 40], [0, 40]];
const G = ringAt(EMPTY_Y923, RECT_M);
const S = 0.015;
const rs = (w: number, h: number) => (w - 2 * S) * (h - 2 * S);

function engine(edges: EngineInput['edges'], extra: Partial<EngineInput> = {}) {
  const out = evaluate({ units: 'm', ring: RECT_M, edges, zone: { code: 'ย.๙-๒๓', far: 7, osrPct: 4.5 }, type: 'condo', nearStation: false, ...extra } as EngineInput);
  if (!out.ok) throw new Error(out.message);
  return out;
}
const road = (w: number, name: string) => ({ role: 'road' as const, width: w, gap: 0, name, source: 'user' as const });
const priv = () => ({ role: 'private' as const, source: 'user' as const });

async function floors(page: Page) {
  await page.locator('.tabs button', { hasText: 'Floors' }).click();
  const rows = await page.$$eval('.floors tbody tr', (rs) => rs.map((r) => [...r.querySelectorAll('td')].map((t) => t.textContent ?? '')));
  const foot = await page.$$eval('.floors tfoot tr', (rs) => rs.map((r) => r.querySelector('td:last-child')?.textContent ?? ''));
  await page.locator('.tabs button', { hasText: /^Designs/ }).click();
  const n = (s: string) => Number(s.replace(/[^\d.]/g, ''));
  return { plates: rows.map((r) => ({ level: n(r[0]!), area: n(r[2]!) })).sort((a, b) => a.level - b.level), sum: n(foot[0]!), reported: n(foot[1]!) };
}
const near = (a: number, b: number, rel = 0.0005, abs = 0.6) => Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b));

test.describe('golden plots on the live map', () => {
  test('G1: 40 x 50 m, 12 m road on the long side, condo', async ({ page }) => {
    await open(page, hashOf(G));
    await settle(page);
    expect((await plotFacts(page))['Plot area']).toBe('2,000 m²');
    await setRoad(page, 0, 12);
    await settle(page);
    const k = await kpis(page);
    const e = engine([road(12, 'A'), priv(), priv(), priv()]);
    const h = e.regimes.high;
    expect(k.regime).toBe('High-rise');
    expect(k.permitted).toBe(14000); // FAR 7 x 2,000
    expect(k.floors).toBe(29);
    expect(k.height).toBeCloseTo(88.5, 1);
    expect(k.regimeLine).toContain('9,800 m² in 7 floors, 22.5 m'); // low regime, OSR-bound
    const f = await floors(page);
    expect(f.plates.length).toBe(h.plates.length);
    for (const p of h.plates) expect(near(f.plates[p.level - 1]!.area, p.area), `level ${p.level}: ${f.plates[p.level - 1]!.area} vs ${p.area}`).toBe(true);
    for (let lv = 1; lv <= 11; lv++) expect(near(f.plates[lv - 1]!.area, rs(28, 38))).toBe(true); // 1,062
    expect(near(f.plates[11]!.area, rs(27.25, 38))).toBe(true); // 2x from z 34.5
    expect(near(f.sum, f.reported, 0.0001, 0.2)).toBe(true); // floors add up
    expect(near(f.reported, h.gfa)).toBe(true);
    const d = await designs(page);
    expect(d.length).toBeGreaterThanOrEqual(2);
    for (const x of d) {
      expect(x.passes).toBe(true);
      expect(x.gfa).toBeLessThanOrEqual(14000);
      expect(near(x.footprint + x.open, 2000, 0.0005, 1.5)).toBe(true); // footprint + open space = plot
    }
    expect(d.some((x) => x.gfa === 14000)).toBe(true);
  });

  test('G2: same plot on an 8 m soi', async ({ page }) => {
    await open(page, hashOf(G));
    await settle(page);
    await setRoad(page, 0, 8);
    await settle(page);
    const k = await kpis(page);
    const e = engine([road(8, 'A'), priv(), priv(), priv()]);
    expect(k.regime).toBe('Low-rise');
    expect(k.regimeLine).toContain('MR 33 art. 2');
    expect(k.permitted).toBe(9800);
    expect(k.floors).toBe(7);
    const f = await floors(page);
    for (let lv = 1; lv <= 6; lv++) expect(near(f.plates[lv - 1]!.area, rs(35, 44))).toBe(true);
    expect(near(f.plates[6]!.area, rs(33.75, 44))).toBe(true); // 2x: 22.5/2 - 8 = 3.25 m
    for (const p of e.regimes.low.plates) expect(near(f.plates[p.level - 1]!.area, p.area)).toBe(true);
    const d = await designs(page);
    expect(d.length).toBeGreaterThanOrEqual(2);
    for (const x of d) expect(x.gfa).toBeLessThan(10000);
  });

  test('G3: corner, 30 m road on the long side and 12 m road on the short side', async ({ page }) => {
    await open(page, hashOf(G));
    await settle(page);
    await setRoad(page, 0, 30);
    await setRoad(page, 3, 12);
    await settle(page);
    const e = engine([road(30, 'wide'), priv(), priv(), road(12, 'narrow')]);
    const k = await kpis(page);
    expect(k.regime).toBe('High-rise');
    expect(k.permitted).toBe(14000);
    const f = await floors(page);
    expect(f.plates.length).toBe(41); // hand: last floor z1 124.5
    expect(near(f.plates[22]!.area, rs(38, 28))).toBe(true);
    expect(near(f.plates[23]!.area, rs(27.25, 38))).toBe(true);
    for (const p of e.regimes.high.plates) expect(near(f.plates[p.level - 1]!.area, p.area), `level ${p.level}`).toBe(true);
    // relief off: the 12 m road's 2x cuts from z > 36 m
    await page.locator('.opts summary').click();
    await page.locator('.opts label', { hasText: 'wider-road relief' }).locator('input').uncheck();
    await settle(page);
    const off = await floors(page);
    expect(near(off.plates[11]!.area, rs(37.25, 28))).toBe(true);
  });
});
