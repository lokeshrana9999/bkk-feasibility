// Drawing and editing a plot with the mouse, top-down camera: the panel follows every edit live.
import { test, expect } from '@playwright/test';
import { open, settle, kpis, ringAt, hashOf, EMPTY_Y923_B, topDown, drawRing, drag, plotFacts, project, frame, watch } from './helpers';

const O = EMPTY_Y923_B;
const f = frame(O[0], O[1]);
const RECT = ringAt(O, [[0, 0], [50, 0], [50, 40], [0, 40]]);

test('draw a 50 x 40 m rectangle by clicking its corners', async ({ page }) => {
  const w = watch(page);
  await open(page);
  await settle(page);
  await topDown(page, f.toLL(25, 20), 18.5);
  await drawRing(page, RECT);
  await settle(page);
  const facts = await plotFacts(page);
  expect(facts['Corners']).toBe('4');
  expect(Number(facts['Plot area']!.replace(/\D/g, ''))).toBeGreaterThan(1960); // click rounding at zoom 18.5
  expect(Number(facts['Plot area']!.replace(/\D/g, ''))).toBeLessThan(2040);
  expect((await kpis(page)).permitted).toBeGreaterThan(0);
  await page.waitForTimeout(900);
  expect(page.url()).toContain('p=100.57486'); // share link follows the drawn plot
  expect(w.errors).toEqual([]);
});

test('drag a corner, click a midpoint, right-click a corner, drag the plot', async ({ page }) => {
  await open(page, hashOf(RECT));
  await settle(page);
  await topDown(page, f.toLL(25, 20), 18.5);
  await drag(page, RECT[2]!, f.toLL(70, 60));
  await settle(page);
  expect((await plotFacts(page))['Plot area']).toBe('2,900 m²');
  // midpoint of the bottom edge: a click inserts a corner
  const [mx, my] = await project(page, f.toLL(25, 0));
  await page.mouse.click(mx, my);
  await page.waitForTimeout(600);
  expect((await plotFacts(page))['Corners']).toBe('5');
  // right-click deletes the corner at (0, 40)
  const [x, y] = await project(page, RECT[3]!);
  await page.mouse.click(x, y, { button: 'right' });
  await page.waitForTimeout(600);
  await settle(page);
  expect((await plotFacts(page))['Corners']).toBe('4');
  // drag the whole plot 100 m north: same area, new place
  const before = (await plotFacts(page))['Plot area'];
  await drag(page, f.toLL(30, 10), f.toLL(30, 110));
  await page.waitForTimeout(900);
  await settle(page);
  expect((await plotFacts(page))['Plot area']).toBe(before);
  expect(page.url()).not.toContain('13.7198373');
});

test('drawing refuses a crossing corner and Escape leaves draw mode', async ({ page }) => {
  await open(page);
  await settle(page);
  await topDown(page, f.toLL(25, 20), 18.5);
  await drawRing(page, ringAt(O, [[0, 0], [50, 40], [50, 0], [0, 40]]));
  await page.waitForTimeout(600);
  // the crossing click is refused, so the outline never self-intersects
  await expect(page.locator('.panel .banner.err', { hasText: 'crosses itself' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('button.btn.primary')).toBeEnabled();
});
