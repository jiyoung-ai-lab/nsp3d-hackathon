// NSP 3D — experiment-subject 3D preview (own tiny renderer next to the panel).
// Shows the selected subject on a slow turntable with idle wing flap.
// Instances are SEPARATE from the sim subject (an Object3D has one parent);
// app.js builds/caches them via the same factories and passes roots here.
export function createSubjectPreview(THREE, container, opts = {}) {
  const W = opts.width || 240, H = opts.height || 190;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(W, H, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xbdd7f2, 0x0a1226, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(0.02, 0.03, 0.025);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(38, W / H, 0.001, 1);
  const turntable = new THREE.Group();
  scene.add(turntable);
  let current = null, currentId = null, visible = false;

  function frame(dist) {
    const d = dist || 0.03;
    camera.position.set(0, d * 0.42, d);
    camera.lookAt(0, 0.001, 0);
    camera.updateProjectionMatrix();
  }
  frame(0.03);
  return {
    setSubject(id, root, dist) {
      if (current) turntable.remove(current);
      current = root || null; currentId = id;
      if (current) {
        current.position.set(0, 0, 0);
        current.rotation.set(0, 0, 0);
        turntable.add(current);
      }
      turntable.rotation.set(0, 0.6, 0);
      frame(dist);
    },
    setVisible(v) { visible = Boolean(v); },
    get visible() { return visible; },
    get subjectId() { return currentId; },
    get root() { return current; },
    render(dt, ts) {
      if (!visible || !current) return;
      turntable.rotation.y += Math.min(dt, 0.05) * 0.6;
      if (current.userData?.updateStudio) current.userData.updateStudio(Math.min(dt, 0.05), ts, false, 0, 0);
      renderer.render(scene, camera);
    },
  };
}
