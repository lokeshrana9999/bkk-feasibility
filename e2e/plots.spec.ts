// Plot shapes and malformed input through the share link: every case ends in a clear state, never a crash.
import { test, expect } from '@playwright/test';
import { open, settle, kpis, designs, watch, ringAt, hashOf, EMPTY_Y923, plotFacts } from './helpers';

const O = EMPTY_Y923;
const circle = (n: number, r: number): [number, number][] => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);
const DEMO_HASH_START = 'p=100.5793403,13.7210608';

test.describe('shapes', () => {
  test('triangle evaluates', async ({ page }) => {
    await open(page, hashOf(ringAt(O, [[0, 0], [60, 0], [10, 50]])));
    await settle(page);
    expect((await plotFacts(page))['Corners']).toBe('3');
    expect((await kpis(page)).permitted).toBeGreaterThan(0);
    expect((await designs(page)).length).toBeGreaterThanOrEqual(2);
  });

  test('L-shape evaluates and floors stay inside the plot area', async ({ page }) => {
    await open(page, hashOf(ringAt(O, [[0, 0], [50, 0], [50, 20], [25, 20], [25, 45], [0, 45]])));
    await settle(page);
    const d = await designs(page);
    expect(d.length).toBeGreaterThanOrEqual(2);
    for (const x of d) expect(x.footprint).toBeLessThanOrEqual(1625);
  });

  for (const [name, pts] of [
    ['3 m wide strip', [[0, 0], [100, 0], [100, 3], [0, 3]]],
    ['3 x 3 m plot', [[0, 0], [3, 0], [3, 3], [0, 3]]],
  ] as const) {
    test(`${name}: says nothing can be built`, async ({ page }) => {
      await open(page, hashOf(ringAt(O, pts as unknown as [number, number][])));
      await settle(page);
      await expect(page.locator('.panel .banner.err')).toContainText('Nothing can be built');
    });
  }

  test('600 x 600 m plot: refused with a size message', async ({ page }) => {
    await open(page, hashOf(ringAt(O, [[-300, -300], [300, -300], [300, 300], [-300, 300]])));
    await settle(page);
    await expect(page.locator('.panel .banner.err')).toContainText('limit');
  });

  test('600-corner round plot evaluates within 10 s', async ({ page }) => {
    const w = watch(page);
    const t0 = Date.now();
    await open(page, hashOf(ringAt(O, circle(600, 40))));
    await settle(page);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect((await plotFacts(page))['Corners']).toBe('600');
    expect((await kpis(page)).permitted).toBeGreaterThan(0);
    expect(w.errors).toEqual([]);
  });

  test('self-intersecting outline: explains instead of computing', async ({ page }) => {
    await open(page, hashOf(ringAt(O, [[0, 0], [50, 40], [50, 0], [0, 40]])));
    await settle(page);
    await expect(page.locator('.panel .banner.err')).toContainText('crosses itself');
    await expect(page.locator('.summary')).toHaveCount(0);
  });

  test('outside ย.9: names the zone it is in', async ({ page }) => {
    await open(page, '#p=100.5300000,13.7240000;100.5303698,13.7240000;100.5303698,13.7243615;100.5300000,13.7243615&t=condo');
    await expect(page.locator('.panel .banner.info')).toContainText('พ.๕-๖', { timeout: 15_000 });
    await expect(page.locator('.summary')).toHaveCount(0);
  });
});

test.describe('malformed share links fall back to the demo', () => {
  for (const [name, h] of [
    ['letters', '#p=abc;def&t=condo'],
    ['NaN', '#p=NaN,1;2,3;4,5&t=hotel'],
    ['huge numbers', '#p=1e308,1;2,3;4,5'],
    ['two points', '#p=100.5775848,13.7171633;100.578,13.7171633'],
    ['empty', '#'],
    ['unknown type', '#t=factory'],
  ] as const) {
    test(name, async ({ page }) => {
      const w = watch(page);
      await open(page, h);
      await settle(page);
      await expect(page).toHaveURL(new RegExp(DEMO_HASH_START.replace(/\./g, '\\.')));
      expect((await kpis(page)).permitted).toBeGreaterThan(0);
      expect(w.errors).toEqual([]);
    });
  }
});
