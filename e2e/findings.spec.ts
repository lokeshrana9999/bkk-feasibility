// One test per issue in e2e/FINDINGS.md. Each asserts the behaviour a fix should give, so these
// fail on the build that was tested (2026-11-20) and turn green as the issues are fixed.
// E2E_EVIDENCE=1 refreshes the screenshots in e2e/screenshots/ that FINDINGS.md links.
import { test, expect, type Page } from '@playwright/test';
import { open, settle, kpis, edgeRows, ringAt, hashOf, EMPTY_Y923, EMPTY_Y923_B, setRoad, setType, plotFacts, topDown, drag, frame, evidence, type LL } from './helpers';

const G1 = ringAt(EMPTY_Y923, [[0, 0], [50, 0], [50, 40], [0, 40]]);
const S38: LL[] = [[100.5793403, 13.7210608], [100.5793802, 13.7207012], [100.5797921, 13.7207449], [100.5797522, 13.7211045]];
const fS = frame(S38[0]![0], S38[0]![1]);
const shiftE = (d: number) => S38.map(([x, y]) => [x + d / fS.kx, y] as LL);
const panelText = (page: Page) => page.locator('.panel').innerText();

test('F01 plot drawn over a public road: warned, road not counted as buildable', async ({ page }) => {
  // the demo plot moved 13 m west: 25% of it lies on the Sukhumvit 38 right-of-way (e2e/tools/row-overlap.ts)
  await open(page, hashOf(shiftE(-13)));
  await settle(page);
  await evidence(page, 'F01-plot-over-road');
  // only warnings count (the footer and section header always mention the right-of-way map)
  const warn = [...(await page.locator('.panel .banner').allInnerTexts()), ...(await page.locator('.edges .tag.warn').allInnerTexts())].join(' | ');
  expect(warn, 'no warning that the plot covers Sukhumvit 38').toMatch(/right-of-way|road/i);
});

test('F02 share link keeps road edits: recipient sees the same numbers', async ({ page, context }) => {
  await open(page, hashOf(G1));
  await settle(page);
  await setRoad(page, 0, 20);
  await setType(page, 'Office');
  await settle(page);
  const sender = await kpis(page);
  await evidence(page, 'F02-share-sender');
  await page.waitForTimeout(1000);
  const p2 = await context.newPage();
  await open(p2, '#' + page.url().split('#')[1]);
  await settle(p2);
  await evidence(p2, 'F02-share-recipient');
  const recipient = await kpis(p2);
  expect({ permitted: recipient.permitted, regime: recipient.regime }).toEqual({ permitted: sender.permitted, regime: sender.regime });
});

test('F03 plot mostly in another zone: not evaluated as ย.9 without naming that zone', async ({ page }) => {
  // 36% in ย.9-23 (FAR 7), 64% in ย.10-7 (FAR 8)
  await open(page, '#p=100.5675863,13.7259857;100.5679562,13.7259857;100.5679562,13.7263472;100.5675863,13.7263472&t=condo');
  await settle(page);
  await evidence(page, 'F03-straddle-y10');
  expect(await panelText(page)).toContain('ย.๑๐');
});

test('F04 a 0.4 m drawing gap to an 11.2 m road: high-rise kept, or the panel says the gap is why', async ({ page }) => {
  await open(page, hashOf(shiftE(0)));
  await settle(page);
  await page.waitForTimeout(1500);
  await settle(page);
  expect((await kpis(page)).regime).toBe('High-rise'); // abutting: 12,554 m2
  await open(page, hashOf(shiftE(0.25))); // edge table shows "gap 0.4 m"
  await settle(page);
  await page.waitForTimeout(1500);
  await settle(page);
  await evidence(page, 'F04-gap-0.4m');
  const k = await kpis(page);
  expect(k.regime === 'High-rise' || /gap|abut|touch/i.test(k.regimeLine), k.regimeLine).toBe(true);
});

test('F05 picking a demo while drawing does not leave the app stuck in draw mode', async ({ page }) => {
  await open(page);
  await settle(page);
  await page.locator('button.btn.primary').click();
  await page.locator('select.sel').first().selectOption({ index: 2 });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await evidence(page, 'F05-stuck-drawing');
  await expect(page.locator('button.btn.primary')).toBeEnabled({ timeout: 3000 });
  await expect(page.locator('.map-hint')).toHaveCount(0);
});

test('F06 the selected edge role chip is visible', async ({ page }) => {
  await open(page);
  await settle(page);
  await page.locator('.edges').scrollIntoViewIfNeeded();
  await evidence(page, 'F06-chip-invisible');
  const bg = await page.locator('.edges .edge .chip.on').first().evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(bg).not.toBe('rgb(255, 255, 255)');
});

test('F07 an out-of-range road width is flagged, not silently ignored', async ({ page }) => {
  await open(page, hashOf(G1));
  await settle(page);
  await setRoad(page, 0, 12);
  await settle(page);
  const row = page.locator('.edges .edge').nth(0);
  const inp = row.locator('.win');
  await inp.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('0');
  await page.waitForTimeout(500);
  await evidence(page, 'F07-width-0-ignored');
  expect(await row.innerText()).toMatch(/1\s*(–|-|to)\s*100|at least 1|invalid|between/i);
});

test('F08 browser Back stays in the app after changing the plot', async ({ page, baseURL }) => {
  await open(page);
  await settle(page);
  await page.locator('select.sel').first().selectOption({ index: 2 });
  await settle(page);
  await page.waitForTimeout(900);
  await page.goBack();
  await page.waitForTimeout(1500);
  expect(page.url().startsWith(baseURL!), `Back went to ${page.url()}`).toBe(true);
});

test('F09 dragging a midpoint adds a corner (as the hint says)', async ({ page }) => {
  const f = frame(EMPTY_Y923_B[0], EMPTY_Y923_B[1]);
  await open(page, hashOf(ringAt(EMPTY_Y923_B, [[0, 0], [50, 0], [50, 40], [0, 40]])));
  await settle(page);
  await topDown(page, f.toLL(25, 20), 18.5);
  await drag(page, f.toLL(25, 0), f.toLL(25, -10));
  await page.waitForTimeout(800);
  await evidence(page, 'F09-midpoint-drag');
  const hint = await page.locator('.panel .hint').first().innerText();
  expect((await plotFacts(page))['Corners'] === '5' || !/drag the small midpoints/.test(hint)).toBe(true);
});

test('F10 messages number edges like the edge table (from 1)', async ({ page }) => {
  await open(page, hashOf(ringAt(EMPTY_Y923, [[0, 0], [100, 0], [100, 3], [0, 3]])));
  await settle(page);
  await evidence(page, 'F10-edge-number-0');
  expect(await panelText(page)).not.toMatch(/#0\b/);
});

test('F11 numbers are not shown as "computed" while the road data is still loading', async ({ page }) => {
  await page.route('**/data/row/**', async (r) => { await new Promise((res) => setTimeout(res, 4000)); await r.continue(); });
  await page.goto('/');
  await page.waitForSelector('.panel');
  await page.waitForTimeout(2500); // demo plot set, roads not yet loaded
  await evidence(page, 'F11-computed-before-roads');
  const aside = (await page.locator('.summary .aside').allInnerTexts()).join(' ');
  const kp = await page.locator('.summary .kpi').count();
  expect(kp === 0 || !/computed/.test(aside), `aside="${aside}" while roads load`).toBe(true);
});

test('F12 outside-ย.9 panel does not claim "no zone" while the city zones load', async ({ page }) => {
  await page.route('**/data/zones_all.json', async (r) => { await new Promise((res) => setTimeout(res, 5000)); await r.continue(); });
  await open(page, '#p=100.5300000,13.7240000;100.5303698,13.7240000;100.5303698,13.7243615;100.5300000,13.7243615&t=condo');
  await expect(page.locator('.plot-facts')).toContainText('outside', { timeout: 20_000 });
  await page.waitForTimeout(500);
  await evidence(page, 'F12-no-zone-while-loading');
  expect(await panelText(page)).not.toContain('No city-plan zone found here');
});

test('F13 "Go to area" labels are unique', async ({ page }) => {
  await open(page);
  await expect(page.locator('select.sel').nth(1).locator('option')).toHaveCount(32);
  const opts = await page.locator('select.sel').nth(1).locator('option').allTextContents();
  expect(opts.filter((o, i) => opts.indexOf(o) !== i)).toEqual([]);
});

test('F14 a share link across the 180° meridian shows a sane plot area', async ({ page }) => {
  await open(page, '#p=179.9998,0;-179.9998,0;-179.9998,0.0004;179.9998,0.0004&t=condo');
  await expect(page.locator('.plot-facts')).toContainText('outside', { timeout: 20_000 });
  await evidence(page, 'F14-antimeridian-area');
  const a = Number(((await plotFacts(page))['Plot area'] ?? '').replace(/\D/g, ''));
  expect(a).toBeLessThan(10_000);
});

test('F15 widths are not taken from half-typed values ("100.5" must not become 100)', async ({ page }) => {
  await open(page, hashOf(G1));
  await settle(page);
  await setRoad(page, 0, 12);
  await settle(page);
  const inp = page.locator('.edges .edge').nth(0).locator('.win');
  await inp.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('100.5');
  await inp.blur();
  await page.waitForTimeout(500);
  const w = (await edgeRows(page))[0]!.width;
  expect(w === '12' || w === '100.5', `width now ${w}`).toBe(true);
});
