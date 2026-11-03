// NSP 3D — headless browser verification (durable harness).
// Requires: playwright + chromium headless shell installed, app served:
//   node nsp3d/tests/serve.mjs --port 8000   (serves the repo root)
//   cd <tmp>; npm init -y; npm i playwright; npx playwright install --only-shell chromium
// Run: NSP_PAGE=http://127.0.0.1:8000/nsp3d/index.html node <tmp>/verify.browser.mjs
// (copy this file next to the temp playwright install, or run with NODE_PATH).
const PAGE = process.env.NSP_PAGE || 'http://127.0.0.1:8000/nsp3d/index.html';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const SHOT = path.join(DIR, 'shots');
fs.mkdirSync(SHOT, { recursive: true });
const R = { errors: [], checks: [], trace: [] };
const check = (name, ok, detail) => R.checks.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 200) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => R.errors.push('pageerror: ' + String((e && e.message) || e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') R.errors.push('console: ' + m.text().slice(0, 200)); });
page.on('requestfailed', (r) => R.errors.push('reqfail: ' + r.url().slice(0, 120)));
const dbg = () => page.evaluate(() => {
  const d = globalThis.__nspDbg;
  return {
    pos: [d.camPos.x, d.camPos.y, d.camPos.z], look: [d.camLook.x, d.camLook.y, d.camLook.z],
    fly: [d.fly.pos.x, d.fly.pos.y, d.fly.pos.z, d.fly.yaw],
  };
});
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
try {
  await page.goto(PAGE, { waitUntil: 'load', timeout: 90000 });
  await page.waitForSelector('#scene canvas', { timeout: 60000 });
  await sleep(6000);
  const shot = (n) => page.screenshot({ path: path.join(SHOT, n) });
  check('no errOverlay', await page.evaluate(() => document.getElementById('errOverlay').style.display !== 'block'), await page.evaluate(() => document.getElementById('errOverlay').textContent.slice(0, 120)));
  const feedMean = await page.evaluate(() => {
    const c = document.getElementById('visionFeed');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 32) { s += d[i] + d[i + 1] + d[i + 2]; n++; }
    return Math.round((s / n / 3) * 100) / 100;
  });
  check('initial fly-eye feed non-black', feedMean > 2, 'mean=' + feedMean + ' status=' + await page.textContent('#visionStatus'));
  check('graph info', true, await page.textContent('#graphInfo'));
  await shot('01-initial.png');
  // ---- one uninterrupted view pass: select + numeric drag assertion ----
  const box = await page.locator('#scene canvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const drag = async () => { await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 220, cy + 130, { steps: 12 }); await page.mouse.up(); await sleep(700); };
  for (const [btn, tag, axis] of [['#cameraTop', 'top', 'look'], ['#cameraFollow', 'follow', 'pos'], ['#cameraCloseup', 'closeup', 'pos'], ['#cameraOverview', 'overview', 'pos']]) {
    await page.click(btn); await sleep(800);
    const label = await page.textContent('#cameraModeLabel');
    const before = await dbg();
    await shot('02-' + tag + '-before.png'); await drag(); await shot('03-' + tag + '-after-drag.png');
    const after = await dbg();
    const moved = axis === 'look' ? dist(before.look, after.look) : dist(before.pos, after.pos);
    check('view ' + tag + ' selected', ((await page.getAttribute(btn, 'class')) || '').includes('selected'), 'label=' + label);
    check('drag moves ' + tag + ' camera', moved > 0.005, axis + ' delta=' + moved.toFixed(4));
  }
  // ---- flight with pose/sector correlation sampling ----
  await page.click('#cameraOverview'); await sleep(500);
  await page.click('#runBtn'); await sleep(500);
  check('flight started', ((await page.textContent('#flightState')) || '').length > 0, await page.textContent('#flightState'));
  const samples = [];
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const d = await dbg();
    samples.push({
      x: +d.fly[0].toFixed(3), y: +d.fly[1].toFixed(3), z: +d.fly[2].toFixed(3),
      sL: parseFloat(await page.textContent('#visionLeft')) / 100, sR: parseFloat(await page.textContent('#visionRight')) / 100,
      sC: parseFloat(await page.textContent('#visionFront')) / 100, sU: parseFloat(await page.textContent('#visionUp')) / 100,
      col: await page.textContent('#collisions'), fps: await page.textContent('#fps'), st: await page.textContent('#flightState'),
    });
    if (i === 7) { await shot('04-flight-mid.png'); const zb = page.locator('.cam-sensor-btn[data-sensor="z_depth"]'); if (await zb.count()) { await zb.first().click(); } }
  }
  R.trace = samples;
  await shot('05-flight-end.png');
  // ---- forced proximity: deterministic ceiling + wall response (still flying) ----
  const setBee = (x, y, z, yaw) => page.evaluate(([bx, by, bz, wy]) => { const f = globalThis.__nspDbg.fly; f.pos.x = bx; f.pos.y = by; f.pos.z = bz; if (wy !== undefined) f.yaw = wy; }, [x, y, z, yaw]);
  const readBee = () => page.evaluate(() => { const f = globalThis.__nspDbg.fly; return { x: f.pos.x, y: f.pos.y, z: f.pos.z, yaw: f.yaw }; });
  const simElapsed = () => page.evaluate(() => globalThis.__nspDbg.fly.elapsed);
  const waitSim = async (sec) => {
    const t0 = await simElapsed();
    const deadline = Date.now() + 60000;
    while ((await simElapsed()) - t0 < sec && Date.now() < deadline) await sleep(500);
  };
  // Forced proximity checks run in fog_rgb (graded gray floor/ceiling read on every
  // sensor now; the old world-Y depth kill was removed with the invisible floor).
  const fogBtn = page.locator('.cam-sensor-btn[data-sensor="fog_rgb"]');
  if (await fogBtn.count()) { await fogBtn.first().click(); await sleep(800); }
  await setBee(0, 0.175, 0); await sleep(1500);
  const sUpTop = parseFloat(await page.textContent('#visionUp')) / 100;
  check('ceiling threat high when 2.5cm below (sUp>0.25)', sUpTop > 0.25, 'sUp=' + sUpTop);
  const yTop0 = (await readBee()).y;
  await waitSim(3);
  const yTop1 = (await readBee()).y;
  check('fly dives away from ceiling (visual path)', yTop1 < yTop0 - 0.02, 'y ' + yTop0.toFixed(3) + ' -> ' + yTop1.toFixed(3));
  await setBee(0.43, 0.1, 0, Math.PI / 2); await sleep(1500);
  const w0 = await readBee();
  const wSec = Math.max(parseFloat(await page.textContent('#visionLeft')), parseFloat(await page.textContent('#visionRight')), parseFloat(await page.textContent('#visionFront'))) / 100;
  check('wall seen at 5cm (sector>0.3)', wSec > 0.3, 'maxSec=' + wSec);
  await waitSim(4);
  const w1 = await readBee();
  let dyaw = Math.abs(w1.yaw - w0.yaw); if (dyaw > Math.PI) dyaw = 2 * Math.PI - dyaw;
  check('fly leaves wall / turns away', w1.x < w0.x - 0.03 || dyaw > 0.5, 'x ' + w0.x.toFixed(2) + '->' + w1.x.toFixed(2) + ' dyaw=' + dyaw.toFixed(2));
  const ys = [...samples.map((s) => s.y), yTop0, yTop1, w0.y, w1.y];
  const maxAlt = Math.max(...ys), minAlt = Math.min(...ys);
  check('altitude within physics clamp [0.6,19.4]cm', ys.every((v) => v >= 0.006 && v <= 0.194), 'min=' + minAlt + ' max=' + maxAlt);
  const pinned = (maxAlt - minAlt <= 0.02) && (minAlt < 0.02 || maxAlt > 0.18);
  check('no floor/ceiling pin', !pinned, 'min=' + minAlt + ' max=' + maxAlt);
  const nearWall = samples.filter((s) => Math.abs(s.x) > 0.38 || Math.abs(s.z) > 0.38);
  if (nearWall.length) {
    const okW = nearWall.filter((s) => Math.max(s.sL, s.sR, s.sC) > 0.2).length;
    check('outer wall seen when near (sector>0.2)', okW > 0, okW + '/' + nearWall.length + ' near-wall samples');
  } else check('outer wall proximity sampled', true, 'fly stayed central; no near-wall samples');
  const nearTop = samples.filter((s) => s.y > 0.14);
  if (nearTop.length) {
    const okC = nearTop.filter((s) => s.sU > 0.1).length;
    check('ceiling seen when near top (sUp>0.1)', okC > 0, okC + '/' + nearTop.length + ' high samples');
  } else check('ceiling proximity sampled', true, 'maxAlt=' + maxAlt);
  const gains = await page.evaluate(() => ['gainLeftOut', 'gainRightOut', 'gainClimbOut', 'gainDiveOut'].map((id) => parseFloat(document.getElementById(id).textContent)));
  check('gains within CONFIG [0.25,2.50]', gains.every((g) => g >= 0.24 && g <= 2.51), gains.join(','));
  const rates = await page.evaluate(() => [...document.querySelectorAll('#activeNodes i')].map((e) => parseFloat(e.textContent)).filter((v) => Number.isFinite(v)));
  check('firing rates finite (LIF EMA <2.0)', rates.length > 0 && rates.every((v) => v >= 0 && v < 2.0), 'n=' + rates.length + ' max=' + (rates.length ? Math.max(...rates).toFixed(3) : '-'));
  check('spikes/frame shown', true, await page.textContent('#neuronCount'));
  const frames = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; (performance.now() - t0 < 2000) ? requestAnimationFrame(tick) : res(n); }; requestAnimationFrame(tick); }));
  check('rAF responsiveness (~fps x2 frames)', frames > 6, frames + ' frames/2s; hud=' + await page.textContent('#fps'));
  check('no page errors during pass', R.errors.length === 0, R.errors.slice(0, 4).join(' | '));
} catch (e) { R.errors.push('script: ' + String((e && e.message) || e).slice(0, 300)); } finally { await browser.close(); }
console.log(JSON.stringify(R, null, 1));
const failed = R.checks.filter((c) => !c.ok);
console.log('CHECKS: ' + (R.checks.length - failed.length) + '/' + R.checks.length + ' ok');
if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.name).join(', ')); process.exitCode = 1; }
