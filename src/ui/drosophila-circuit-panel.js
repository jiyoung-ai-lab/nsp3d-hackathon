/**
 * Drosophila Neural Fiber Panel (drosophila-circuit-panel.js)
 * Three.js organic fiber web (INPUT -> CIRCUIT -> BEHAVIOR), driven by real SNN decision data.
 * update(data): { loom, flow, target, vert, dnL, dnR, gaba, dive }
 */
import { NeuralFiberView } from './neural-fiber-view.js';

const NODES = [
  { id: 0, x: -45, y: 15, z: 0, name: 'LEFT', region: 'input' },
  { id: 1, x: -45, y: -15, z: 0, name: 'RIGHT', region: 'input' },
  { id: 3, x: -15, y: 20, z: 5, name: 'LOOM', region: 'circuit' },
  { id: 4, x: -15, y: 0, z: -8, name: 'FLOW', region: 'circuit' },
  { id: 5, x: -15, y: -20, z: 5, name: 'VERT', region: 'circuit' },
  { id: 6, x: 15, y: 12, z: 0, name: 'DN-L', region: 'circuit' },
  { id: 7, x: 15, y: -12, z: 0, name: 'DN-R', region: 'circuit' },
  { id: 8, x: 45, y: 12, z: 0, name: 'TURN-L', region: 'behavior' },
  { id: 9, x: 45, y: -12, z: 0, name: 'TURN-R', region: 'behavior' },
];

const EDGES = [
  { source: 0, target: 3 }, { source: 0, target: 4 },
  { source: 1, target: 4 }, { source: 1, target: 5 },
  { source: 3, target: 6 }, { source: 4, target: 6 },
  { source: 4, target: 7 }, { source: 5, target: 7 },
  { source: 6, target: 8 }, { source: 7, target: 9 },
];

export function createDrosophilaCircuitPanel(containerEl, options = {}) {
  if (!containerEl) return null;

  containerEl.innerHTML = `
  <div class="nsp-neuro3d">
    <style>
      .nsp-neuro3d { background: #182333; border: 1px solid #34445b; border-radius: 14px; padding: 16px; color: #e8f0fa; font-family: Arial, sans-serif; }
      .nsp-neuro3d .nn3-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .nsp-neuro3d .nn3-header h3 { margin: 0; font-size: 17px; }
      .nsp-neuro3d .nn3-status { color: #55e6a5; font-size: 12px; }
      .nsp-neuro3d .nn3-canvas { width: 100%; height: 300px; background: #000; border-radius: 10px; overflow: hidden; }
      .nsp-neuro3d .nn3-canvas canvas { display: block; }
      .nsp-neuro3d .nn3-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 10px; font-size: 11px; color: #91a8c2; }
      .nsp-neuro3d .nn3-legend b { color: #dce8f5; font-weight: normal; }
      .nsp-neuro3d .nn3-legend .on { color: #55e6ff; }
      .nsp-neuro3d .nn3-info { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 12px; }
      .nsp-neuro3d .nn3-card { background: #202f42; border-radius: 8px; padding: 10px 12px; }
      .nsp-neuro3d .nn3-card small { color: #91a8c2; }
      .nsp-neuro3d .nn3-card strong { display: block; margin-top: 6px; font-size: 18px; }
      .nsp-neuro3d .nn3-card .nn3-sub { font-size: 11px; color: #91a8c2; margin-top: 4px; min-height: 14px; }
      .nsp-neuro3d .nn3-bar { height: 6px; background: #34465c; border-radius: 5px; margin-top: 8px; overflow: hidden; }
      .nsp-neuro3d .nn3-bar span { display: block; height: 100%; width: 0; background: #55dfff; transition: width .2s; }
      @media(max-width:600px) { .nsp-neuro3d .nn3-info { grid-template-columns: 1fr; } }
    </style>
    <div class="nn3-header">
      <h3>Neural Activity 3D</h3>
      <span class="nn3-status">● LIVE SIMULATION</span>
    </div>
    <div class="nn3-canvas"></div>
    <div class="nn3-legend"></div>
    <div class="nn3-info">
      <div class="nn3-card"><small>Active Neurons</small><strong class="nn3-active">0 / 9</strong></div>
      <div class="nn3-card"><small>Average Activation</small><strong class="nn3-avg">0%</strong><div class="nn3-bar"><span class="nn3-avgbar"></span></div></div>
      <div class="nn3-card"><small>Selected Behavior</small><strong class="nn3-behavior">IDLE</strong><div class="nn3-sub"></div></div>
    </div>
  </div>`;

  const canvasBox = containerEl.querySelector('.nn3-canvas');
  const legendBox = containerEl.querySelector('.nn3-legend');
  const elActive = containerEl.querySelector('.nn3-active');
  const elAvg = containerEl.querySelector('.nn3-avg');
  const elAvgBar = containerEl.querySelector('.nn3-avgbar');
  const elBehavior = containerEl.querySelector('.nn3-behavior');
  const elSub = containerEl.querySelector('.nn3-sub');

  const view = new NeuralFiberView(canvasBox, {});
  view.camera.position.set(0, 0, 110);
  view.setGraph(NODES, EDGES);

  const legendItems = NODES.map((n) => {
    const s = document.createElement('span');
    s.innerHTML = `${n.name} <b>0.00</b>`;
    legendBox.appendChild(s);
    return s.querySelector('b');
  });

  const clamp01 = (v) => Math.min(1, Math.max(0, v || 0));
  let lastPulse = 0;

  function update(data = {}) {
    // Same mapping as the 2D diagram: DN sums (0..9) normalized by /3.
    const dnL = clamp01((data.dnL || 0) / 3);
    const dnR = clamp01((data.dnR || 0) / 3);
    const base = Math.max(data.flow || 0, (data.loom || 0) * 0.6, (data.target || 0) * 0.4);
    const lat = Math.min(0.5, Math.max(-0.5, ((data.dnL || 0) - (data.dnR || 0)) / 4));
    const values = {
      0: clamp01(base * (0.6 + lat)),
      1: clamp01(base * (0.6 - lat)),
      3: clamp01(data.loom || 0),
      4: clamp01(Math.max(data.flow || 0, data.target || 0)),
      5: clamp01(data.vert || 0),
      6: dnL,
      7: dnR,
      8: dnL,
      9: dnR,
    };
    view.updateActivity(values);

    // Throttled signal pulse along one random active edge (update runs every frame).
    const now = performance.now();
    if (now - lastPulse > 150) {
      const live = EDGES.filter((e) => (values[e.source] || 0) >= 0.5 && (values[e.target] || 0) >= 0.5);
      if (live.length) {
        const e = live[(Math.random() * live.length) | 0];
        view.pulse(e.source, e.target);
        lastPulse = now;
      }
    }

    let active = 0, total = 0;
    NODES.forEach((n, i) => {
      const v = values[n.id] || 0;
      total += v;
      if (v >= 0.5) active++;
      if (legendItems[i]) {
        legendItems[i].textContent = v.toFixed(2);
        legendItems[i].className = v >= 0.5 ? 'on' : '';
      }
    });
    const avg = total / NODES.length;
    if (elActive) elActive.textContent = `${active} / ${NODES.length}`;
    if (elAvg) elAvg.textContent = `${Math.round(avg * 100)}%`;
    if (elAvgBar) elAvgBar.style.width = `${avg * 100}%`;
    let behavior = 'IDLE';
    if (values[8] >= 0.5) behavior = 'TURN LEFT';
    if (values[9] >= 0.5) behavior = 'TURN RIGHT';
    if (elBehavior) elBehavior.textContent = behavior;
    if (elSub) {
      const flags = [];
      if (data.gaba) flags.push('GABA gate');
      if (data.dive && data.dive !== '대기') flags.push(String(data.dive));
      elSub.textContent = flags.join(' · ');
    }
  }

  return { update, dispose: () => view.dispose() };
}
