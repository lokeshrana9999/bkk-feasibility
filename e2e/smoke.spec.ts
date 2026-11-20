// Smoke: the site loads clean, every demo plot evaluates, areas, search, layers, rules and 400 px work.
import { test, expect } from '@playwright/test';
import { open, settle, kpis, designs, watch } from './helpers';

const appErrors = (w: ReturnType<typeof watch>) => ({
  errors: w.errors,
  failed: w.failed.filter((f) => !/openfreemap|ERR_ABORTED/.test(f)), // aborted basemap tiles on camera moves are normal
});

test('loads the demo plot with a result and a clean console', async ({ page }) => {
  const w = watch(page);
  await open(page);
  await settle(page);
  const k = await kpis(page);
  expect(k.permitted).toBeGreaterThan(0);
  expect((await designs(page)).length).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.edges .edge')).toHaveCount(4);
  expect(appErrors(w)).toEqual({ errors: [], failed: [] });
});

test('every demo plot evaluates with 2+ passing designs', async ({ page }) => {
  await open(page);
  await settle(page);
  const sel = page.locator('select.sel').first();
  const n = (await sel.locator('option').count()) - 1;
  expect(n).toBeGreaterThanOrEqual(3);
  for (let i = 1; i <= n; i++) {
    await sel.selectOption({ index: i });
    await page.waitForTimeout(400);
    await settle(page);
    const d = await designs(page);
    expect(d.length, `demo ${i}`).toBeGreaterThanOrEqual(2);
    expect(d.filter((x) => x.passes).length, `demo ${i}`).toBeGreaterThanOrEqual(2);
  }
});

test('go to area flies to each sampled area and loads its data', async ({ page }) => {
  const w = watch(page);
  await open(page);
  await settle(page);
  const sel = page.locator('select.sel').nth(1);
  expect(await sel.locator('option').count()).toBe(32); // placeholder + 31 areas
  const seen = new Set<string>();
  for (const idx of [1, 9, 15, 23, 31]) {
    await sel.selectOption({ index: idx });
    await page.waitForTimeout(1600);
    await page.waitForFunction(() => !document.querySelector('.map-status'), null, { timeout: 30_000 });
    const c = await page.evaluate(() => { const m = (window as any).__e2eMap; return `${m.getCenter().lng.toFixed(3)},${m.getCenter().lat.toFixed(3)}`; });
    seen.add(c);
  }
  expect(seen.size).toBe(5);
  expect(appErrors(w)).toEqual({ errors: [], failed: [] });
});

test('search finds sois, stations and coordinates; junk is safe', async ({ page }) => {
  await open(page);
  await settle(page);
  const s = page.locator('.search input');
  const res = page.locator('.search .results li');
  await s.fill('Sukhumvit 38');
  await expect(res.first()).toContainText('Sukhumvit 38');
  await s.fill('ทองหล่อ');
  await expect(res.first()).toContainText('Thong Lo');
  await s.fill('13.7220, 100.5770');
  await expect(res.first()).toContainText('13.722000, 100.577000');
  await s.fill('<img src=x onerror=alert(1)>');
  await expect(res.first()).toHaveText('No match');
  await s.fill('Sukhumvit 38');
  await s.press('Enter');
  await page.waitForTimeout(2000);
  const c = await page.evaluate(() => { const m = (window as any).__e2eMap; return [m.getCenter().lng, m.getCenter().lat]; });
  expect(Math.abs(c[0] - 100.579)).toBeLessThan(0.01);
  expect(Math.abs(c[1] - 13.72)).toBeLessThan(0.01);
});

test('layers toggle without errors; rules show the Thai source text', async ({ page }) => {
  const w = watch(page);
  await open(page);
  await settle(page);
  for (const l of ['Allowed envelope', 'Other regime', '2:1 road plane', 'Neighbour buildings', 'City right-of-way']) {
    await page.locator('.legend label', { hasText: l }).click();
    await page.waitForTimeout(200);
  }
  await page.locator('.tabs button', { hasText: 'Rules' }).click();
  expect(await page.locator('.rule').count()).toBeGreaterThan(10);
  await page.locator('.rule .rh').first().click();
  await expect(page.locator('.rule blockquote').first()).toContainText(/[฀-๿]/);
  expect(appErrors(w)).toEqual({ errors: [], failed: [] });
});

test('400 px wide: no horizontal scroll, panel reachable', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await open(page);
  await settle(page);
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw).toBeLessThanOrEqual(cw);
  const over = await page.evaluate(() => [...document.querySelectorAll('.panel *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length);
  expect(over).toBe(0);
  await page.locator('.summary').scrollIntoViewIfNeeded();
  await expect(page.locator('.summary .kpi').first()).toBeVisible();
});
