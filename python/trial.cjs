// NSP3D single-trial headless runner (Ax loop worker). CommonJS (.cjs) because
// package.json is type:module.
// Usage: node trial.cjs --config cfg01 --runs 3 --seed 20261031 [--learning 0]
//        [--sens 0.8] [--cruise 0.12] [--maxt 60] [--render off] [--timeout 1800000]
// Base URL: NSP_BASE_URL env, default http://127.0.0.1:8000/pages/experiment.html
// (serve the repo root first, e.g. python -m http.server 8000).
// Prints one JSON line to stdout; exit 0 on completed trial, 1 on failure.
const BASE_URL = process.env.NSP_BASE_URL || 'http://127.0.0.1:8000/pages/experiment.html';
let pw;
try {
  pw = require('playwright-core');
} catch (e) {
  // Optional local override: set NSP_PLAYWRIGHT_CORE to a module path.
  pw = require(process.env.NSP_PLAYWRIGHT_CORE || 'playwright-core');
}
const { chromium } = pw;

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i];
  args[k.replace(/^--/, '')] = process.argv[i + 1];
}
const cfg = args.config || 'cfg01';
const runs = args.runs || '3';
const seed = args.seed || '20261031';
const q = new URLSearchParams({
  configs: cfg, runs, seed, render: args.render || 'off', autostart: '1',
});
if (args.learning) q.set('learning', args.learning);
if (args.sens) q.set('sens', args.sens);
if (args.cruise) q.set('cruise', args.cruise);
if (args.maxt) q.set('maxt', args.maxt);
if (args.cfgfile) q.set('cfgfile', args.cfgfile);
const timeout = +(args.timeout || 1800000);

(async () => {
  const launchOpts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] }; // container-safe (no-op on desktop); /dev/shm is tiny in Docker
  if (process.env.NSP_SWIFTSHADER) launchOpts.args.push('--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu'); // software WebGL for GPU-less containers only
  if (process.env.NSP_CHROMIUM) launchOpts.executablePath = process.env.NSP_CHROMIUM;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const t0 = Date.now();
  await page.goto(`${BASE_URL}?${q.toString()}`, { waitUntil: 'load', timeout: 60000 });
  // batchDone idles true: wait for run start first, then completion.
  await page.waitForFunction(() => window.__expDbg && window.__expDbg.status.indexOf('running') === 0, null, { timeout: 120000 });
  await page.waitForFunction(() => window.__expDbg && window.__expDbg.batchDone === true && window.__expDbg.status === 'idle', null, { timeout });
  const res = await page.evaluate(() => {
    const pc = window.__expDbg.results || {};
    const ids = Object.keys(pc);
    const id = ids[0];
    const runsArr = (id && pc[id].runs) || [];
    // Last known position per slot (runs=4 == 1 wave == 1 run/slot).
    const fl = window.__expDbg.flightLog || [];
    const lastPos = {};
    for (const e of fl) lastPos[e.slot] = e.pos;
    return {
      config: id, n: runsArr.length,
      rows: runsArr.map((r) => ({
        run: r.run, seed: r.seed, slot: r.slot,
        success: !!r.success, reason: r.reason || null,
        collisions: r.collisions, elapsed_s: r.elapsed_s,
        path_m: r.path_m, avg_speed: r.avg_speed,
        final_d: r.final_d, reward: r.reward,
        final_pos: lastPos[r.slot] || null,
      })),
    };
  });
  const wall = Math.round((Date.now() - t0) / 1000);
  const succ = res.rows.filter((r) => r.success).length;
  const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  console.log(JSON.stringify({
    config: res.config, n: res.n, succ,
    success_rate: res.n ? succ / res.n : 0,
    mean_collisions: +mean(res.rows.map((r) => r.collisions)).toFixed(3),
    mean_time: +mean(res.rows.map((r) => r.elapsed_s)).toFixed(2),
    wall_s: wall, errors: errors.slice(0, 3), rows: res.rows,
  }));
  await browser.close();
})().catch((e) => { console.error('TRIAL_FAIL ' + e.message); process.exit(1); });
