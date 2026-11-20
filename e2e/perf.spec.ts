// Performance on this machine's GPU (ANGLE D3D11). Headless SwiftShader is ~10x slower and not
// representative, so the GPU checks skip when no hardware renderer is available.
import { test, expect, type Page } from '@playwright/test';
import { open, settle } from './helpers';

test.use({ launchOptions: { args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] } });

async function renderer(page: Page) {
  return page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null;
    if (!c) return 'none';
    const ext = c.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER));
  });
}

async function editLatency(page: Page, act: () => Promise<void>) {
  const before = await page.locator('.summary').innerText();
  const t0 = await page.evaluate(() => performance.now());
  await act();
  await page.waitForFunction((b) => { const s = document.querySelector('.summary')?.textContent ?? ''; return s !== b && !s.includes('updating'); }, before, { timeout: 10_000 });
  return (await page.evaluate(() => performance.now())) - t0;
}

async function orbitFps(page: Page, ms = 4000) {
  return page.evaluate((dur) => new Promise<{ fps: number; worst: number }>((res) => {
    const m = (window as any).__e2eMap;
    let frames = 0; const t0 = performance.now(); let last = t0; let worst = 0;
    const tick = () => {
      frames++; const now = performance.now(); worst = Math.max(worst, now - last); last = now;
      m.setBearing(m.getBearing() + 1);
      if (now - t0 < dur) requestAnimationFrame(tick); else res({ fps: frames / ((now - t0) / 1000), worst });
    };
    requestAnimationFrame(tick);
  }), ms);
}

test('edit to updated panel under 300 ms; orbit with neighbours at 30+ fps', async ({ page }, info) => {
  await open(page);
  await settle(page);
  const r = await renderer(page);
  test.skip(/swiftshader|llvmpipe|none/i.test(r), `software renderer: ${r}`);
  const lat: number[] = [];
  for (const t of ['Office', 'Condo', 'Hotel', 'Condo']) lat.push(await editLatency(page, () => page.locator('.seg button', { hasText: t }).click()));
  const inp = page.locator('.edges .edge').nth(0).locator('.win');
  for (const v of ['20', '8', '11.2']) lat.push(await editLatency(page, () => inp.fill(v)));
  const fps = await orbitFps(page);
  info.annotations.push({ type: 'perf', description: `${r}; edit->panel ms ${lat.map((x) => x.toFixed(0)).join(', ')}; orbit ${fps.fps.toFixed(1)} fps, worst frame ${fps.worst.toFixed(0)} ms` });
  console.log(info.annotations.at(-1)!.description);
  expect(Math.max(...lat)).toBeLessThan(300);
  expect(fps.fps).toBeGreaterThan(30);
});

test('weaker laptop (CPU x4 slower): edit to updated panel, median under 300 ms, worst under 1 s', async ({ page, context }, info) => {
  await open(page);
  await settle(page);
  const r = await renderer(page);
  test.skip(/swiftshader|llvmpipe|none/i.test(r), `software renderer: ${r}`);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const lat: number[] = [];
  for (const t of ['Office', 'Condo', 'Hotel', 'Condo']) lat.push(await editLatency(page, () => page.locator('.seg button', { hasText: t }).click()));
  const fps = await orbitFps(page);
  info.annotations.push({ type: 'perf', description: `CPU x4: edit->panel ms ${lat.map((x) => x.toFixed(0)).join(', ')}; orbit ${fps.fps.toFixed(1)} fps, worst ${fps.worst.toFixed(0)} ms` });
  console.log(info.annotations.at(-1)!.description);
  const sorted = [...lat].sort((a, b) => a - b);
  expect(sorted[Math.floor(sorted.length / 2)]!).toBeLessThan(300);
  expect(sorted.at(-1)!).toBeLessThan(1000);
});
