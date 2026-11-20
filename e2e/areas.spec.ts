// Every ย.9 area (all 31 polygons): a 30 x 30 m plot at the area's label point loads its roads
// and buildings, finds the zone, and ends in a result or a clear message, with a clean console.
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { open, settle, watch, ringAt, hashOf, type LL } from './helpers';

interface Area { id: number; label: string; labelLatin: string; far: number; osr: number; labelPoint: LL }
const areas = (JSON.parse(readFileSync('public/data/areas.json', 'utf8')) as { areas: Area[] }).areas;

test.describe.configure({ mode: 'parallel' });

for (const a of areas) {
  test(`area ${a.labelLatin} (${a.id}): plot at the label point evaluates`, async ({ page }) => {
    const w = watch(page);
    const ring = ringAt(a.labelPoint, [[-15, -15], [15, -15], [15, 15], [-15, 15]]);
    await open(page, hashOf(ring));
    await settle(page);
    const facts = await page.locator('.plot-facts').innerText();
    const kpis = await page.locator('.summary .kpi').count();
    const banners = (await page.locator('.panel .banner').allInnerTexts()).join(' | ');
    if (facts.includes('outside')) {
      // a label point near a thin area's edge: the panel must name the majority zone
      expect(banners).toMatch(/Most of it .* is in/);
    } else {
      expect(facts).toContain(a.label);
      expect(facts).toContain(`FAR ${a.far}`);
      expect(kpis > 0 || /Nothing can be built|whole plot lies on/.test(banners), banners).toBe(true);
    }
    expect(w.errors).toEqual([]);
    expect(w.failed.filter((f) => !/openfreemap|ERR_ABORTED/.test(f))).toEqual([]);
  });
}
