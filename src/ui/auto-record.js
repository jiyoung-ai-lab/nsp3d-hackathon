// NSP 3D — auto-record via URL params (desktop one-click capture).
// Usage: index.html?scenario=corridor&vision=binocular&sensor=sensor_fusion&neuron=alif_surrogate&view=cameraFollow&fly=1&rec=20
// No imports, no flight-logic changes: only sets UI controls and clicks buttons.
(function () {
  const q = new URLSearchParams(location.search);
  if (!q.get('fly') && !q.get('rec')) return;
  const SEC = Math.max(1, Math.min(300, +(q.get('rec') || 0)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function setSelect(id, v) {
    if (!v) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function waitFor(id, timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (document.getElementById(id)) return true;
      await sleep(300);
    }
    return false;
  }
  window.addEventListener('load', async () => {
    try {
      if (!(await waitFor('runBtn', 15000))) return;
      await sleep(1500);
      const sc = document.getElementById('scenario');
      const maze = (q.get('scenario') || '').toLowerCase();
      if (sc && maze) {
        for (const o of sc.options) {
          if ((o.value + o.text).toLowerCase().includes(maze)) {
            sc.value = o.value;
            sc.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }
      setSelect('controlMode', 'neurons');
      setSelect('visionTypeSelect', q.get('vision'));
      setSelect('cameraSensorSelect', q.get('sensor'));
      setSelect('neuronRuleSelect', q.get('neuron'));
      const view = q.get('view');
      if (view) {
        const el = document.getElementById(view);
        if (el) el.click();
      }
      await sleep(1500);
      document.getElementById('runBtn').click();
      if (!SEC) return;
      await sleep(2000);
      document.getElementById('recBtn').click();
      await sleep(SEC * 1000);
      document.getElementById('recBtn').click();
      document.title = '[REC-DONE] ' + document.title;
    } catch (e) { /* manual fallback: user clicks */ }
  });
})();
