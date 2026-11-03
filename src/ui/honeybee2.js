// Meta-AI honeybee ("honeybee2") — GLB-backed experiment subject exposing the
// same userData API as hand-drawn-bee.js so the studio panel drives both.
// Asset: assets/models/bee_meta_ai.glb (Meta AI generation from an
// acquaintance's reference drawing; permissioned, no license worry per owner).
// GLB facts (measured): real-scale ~9mm body, head toward +Z, wings WING_L
// (-X) / WING_R (+X) with identity node transforms, no animations, no skins.
// Frame notes: model.rotation.y = PI faces the head -Z (hand-built
// convention). Anim amplitudes below are xUNIT because hand-built math lives
// in ~unit space under a 0.00333 model scale while the GLB is metric.
// Directional moves (evade/bank/idle) are remapped: this local (x,y,z) lands
// at world (-x,y,-z), vs hand-built local landing at (-z,y,x). Wing pivots,
// dizzy stars and the shock ring are rebuilt here (measured wing roots);
// sweep/pitch wing-yaw nuance is dropped (GLB wings have no yaw DOF).

const UNIT = 0.00333; // hand-built anim unit -> meters
const DEFAULT_ASSET = 'assets/models/bee_meta_ai.glb';
// Wing-root pivots from measured mesh bounds (x inner edge, y/z centers).
const WING_PIVOT = { L: [-0.00045, 0.0016, 0.0002], R: [0.00045, 0.0016, 0.0002] };

export async function createHoneybee2(THREE, loader, opts = {}) {
  const gltf = await loader.loadAsync(opts.asset || DEFAULT_ASSET);
  const scene = gltf.scene;
  const root = new THREE.Group(), model = new THREE.Group(), animGroup = new THREE.Group(), deformGroup = new THREE.Group();
  model.add(animGroup); animGroup.add(deformGroup); deformGroup.add(scene);
  model.rotation.y = Math.PI;
  root.add(model);
  scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  const find = (name, optional = false) => {
    const o = scene.getObjectByName(name);
    if (!o && !optional) {
      const names = [];
      scene.traverse((x) => { if (x.name) names.push(x.name); });
      throw new Error(`honeybee2: missing node ${name} (have: ${names.join(',')})`);
    }
    return o;
  };
  const wingL = find('WING_L'), wingR = find('WING_R');
  const eyeMeshes = [find('EYE_L'), find('EYE_R')];
  const bodyMesh = find('BODY');
  const bodyMat = bodyMesh.material;
  // NOTE: GLTFLoader strips '.' from node names at load, so the JSON names
  // 'STRIPE_-0.0005' / 'STRIPE_0.0015' arrive as 'STRIPE_-00005' / 'STRIPE_00015'.
  const stripeMesh = find('STRIPE_-00005');
  const stripeMat = stripeMesh.material;
  const wingMat = wingL.material;
  const eyeMatOrig = eyeMeshes[0].material;
  const bodyBase = bodyMat.color.clone(), stripeBase = stripeMat.color.clone();
  const eyeBlackoutMat = new THREE.MeshStandardMaterial({ color: 0x020202, roughness: .98, metalness: 0 });

  // Flap pivots at the measured wing roots. side +1 (R, +X) lands on the
  // bee's left after the PI yaw, so it takes leftAmp like hand-built side>0.
  const wingPivots = [];
  for (const [mesh, key, side] of [[wingL, 'L', -1], [wingR, 'R', 1]]) {
    const pivot = new THREE.Group();
    pivot.position.fromArray(WING_PIVOT[key]);
    mesh.parent.add(pivot);
    pivot.attach(mesh); // keeps world transform; mesh local becomes pivot-relative
    wingPivots.push({ pivot, side });
  }

  // Dizzy stars + shock ring (same visual language, UNIT-scaled).
  const dizzyStarsGroup = new THREE.Group();
  dizzyStarsGroup.position.set(-.55 * UNIT, 1.38 * UNIT, 0);
  dizzyStarsGroup.visible = false; deformGroup.add(dizzyStarsGroup);
  const starMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2;
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(.13 * UNIT, 0), starMat);
    star.position.set(Math.cos(ang) * .58 * UNIT, 0, Math.sin(ang) * .58 * UNIT);
    dizzyStarsGroup.add(star);
  }
  const shockRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.45 * UNIT, .075 * UNIT, 10, 28),
    new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0, depthWrite: false })
  );
  shockRing.rotation.x = Math.PI / 2;
  shockRing.visible = false;
  deformGroup.add(shockRing);

  const state = {
    wingMode: 'idle', wingAngleDeg: 26, wingScale: 1.0, flapSpeedMult: 1.0, colorDepth: 1.15,
    blackEyeActive: false, blackEyeLocked: false, blackEyeTimer: 0,
    impactFlashTimer: 0,
    crashPhase: 'none', crashTimer: 0,
    evadeDir: null, evadeTimer: 0, evadeDuration: .62,
    squashAmp: 0, squashPhase: 0
  };

  function setBlackEye(isBlack) {
    for (const eye of eyeMeshes) { eye.material = isBlack ? eyeBlackoutMat : eyeMatOrig; eye.scale.setScalar(isBlack ? 1.09 : 1); }
  }
  function setWingScale(mult) {
    state.wingScale = Math.max(.5, Math.min(2, Number(mult) || 1));
    for (const w of wingPivots) w.pivot.scale.setScalar(state.wingScale);
    return state.wingScale;
  }
  function setColorDepth(mult) {
    state.colorDepth = Math.max(.8, Math.min(1.5, Number(mult) || 1.15));
    const f = state.colorDepth / 1.15; // brightness-equivalent (GLB has no stripe canvas)
    bodyMat.color.copy(bodyBase).multiplyScalar(f);
    stripeMat.color.copy(stripeBase).multiplyScalar(f);
  }
  function setSubWingsVisible() { /* GLB has no subwings; kept for API parity */ }
  function setWingPose(mode = 'idle', angleDeg = 26) {
    state.wingMode = mode;
    if (Number.isFinite(Number(angleDeg))) state.wingAngleDeg = Number(angleDeg);
  }
  function setFlapSpeed(mult) { state.flapSpeedMult = Math.max(0, Math.min(2.5, Number(mult) ?? 1)); }
  function setBlackEyeLock(locked) {
    state.blackEyeLocked = Boolean(locked);
    state.blackEyeActive = state.blackEyeLocked;
    setBlackEye(state.blackEyeActive);
  }
  function triggerBlackEyeImpact(duration = 1.1) {
    state.blackEyeActive = true; state.blackEyeTimer = Math.max(.55, Number(duration) || 1.1); setBlackEye(true);
    state.impactFlashTimer = .52;
    dizzyStarsGroup.visible = true;
    shockRing.visible = true;
    state.squashAmp = .32; state.squashPhase = 0;
  }
  function triggerObstacleCrash() {
    state.crashPhase = 'falling'; state.crashTimer = 0; state.evadeDir = null;
    state.blackEyeActive = true; state.blackEyeTimer = 1.9; setBlackEye(true);
    state.impactFlashTimer = .75;
    dizzyStarsGroup.visible = true; shockRing.visible = true; state.squashAmp = .34; state.squashPhase = 0;
  }
  function evade(dir) {
    if (state.crashPhase === 'falling') return;
    state.evadeDir = dir; state.evadeTimer = 0;
  }
  function updateStudio(dt, nowMs, isFlying = false, flightTurn = 0, flightClimb = 0) {
    const elapsed = nowMs * .001;
    if (state.blackEyeActive && !state.blackEyeLocked && state.crashPhase === 'none') {
      state.blackEyeTimer -= dt;
      dizzyStarsGroup.visible = state.blackEyeTimer > .15;
      dizzyStarsGroup.rotation.y = elapsed * 11;
      dizzyStarsGroup.rotation.z = Math.sin(elapsed * 9) * .22;
      if (state.blackEyeTimer <= 0) { state.blackEyeActive = false; dizzyStarsGroup.visible = false; setBlackEye(false); }
    }
    if (state.impactFlashTimer > 0) {
      state.impactFlashTimer = Math.max(0, state.impactFlashTimer - dt);
      const pulse = state.impactFlashTimer / .52;
      bodyMat.emissive.setHex(0xef4444);
      bodyMat.emissiveIntensity = pulse * .72;
      shockRing.scale.setScalar(.85 + (1 - pulse) * 1.35);
      shockRing.material.opacity = pulse * .85;
      if (state.impactFlashTimer <= 0) {
        bodyMat.emissiveIntensity = 0;
        shockRing.visible = false;
      }
    }
    let posX = 0, posY = state.wingMode === 'idle' && state.crashPhase === 'none' ? Math.sin(elapsed * 3.2) * .06 : 0, posZ = 0;
    let rotX = 0, rotY = 0, rotZ = 0;
    if (state.wingMode === 'idle' && state.crashPhase === 'none') rotX = Math.cos(elapsed * 3.2) * .03; // world -X sway (hand-built rotZ equivalent)
    let leftAmp = 1, rightAmp = 1;

    if (state.crashPhase === 'falling') {
      state.crashTimer += dt;
      const p = Math.min(1, state.crashTimer / 1.65), turns = p * Math.PI * 2 * 3.5, radius = .38 * Math.sin(p * Math.PI);
      posX = Math.cos(turns) * radius; posZ = Math.sin(turns) * radius;
      posY = p < .8 ? -.95 * Math.pow(p / .8, 1.4) : -0.95 * (1 - (p - .8) / .2);
      rotY = turns; rotZ = .38 * Math.sin(p * Math.PI); rotX = .32 * Math.cos(turns * .5);
      dizzyStarsGroup.rotation.y = elapsed * 10; dizzyStarsGroup.rotation.z = Math.sin(elapsed * 8) * .18;
      if (p >= 1) { state.crashPhase = 'none'; dizzyStarsGroup.visible = false; if (!state.blackEyeLocked) { state.blackEyeActive = false; setBlackEye(false); } }
    } else if (state.impactFlashTimer > .05) {
      const wobble = state.impactFlashTimer / .52;
      posZ = .28 * wobble; // world -Z jolt (hand-built posX equivalent)
      rotY = Math.sin(elapsed * 48) * .38 * wobble;
      rotZ = Math.cos(elapsed * 42) * .28 * wobble;
      rotX = Math.sin(elapsed * 36) * .32 * wobble;
    } else if (state.evadeDir) {
      state.evadeTimer += dt;
      const u = Math.min(1, state.evadeTimer / state.evadeDuration), bell = Math.sin(u * Math.PI), snap = Math.sin(Math.pow(u, .7) * Math.PI);
      if (state.evadeDir === 'left') { posX = .85 * bell; posY += .10 * bell; rotZ = .55 * snap; rotY = -.38 * snap; leftAmp = .65; rightAmp = 1.45; }
      else if (state.evadeDir === 'right') { posX = -.85 * bell; posY += .10 * bell; rotZ = -.55 * snap; rotY = .38 * snap; leftAmp = 1.45; rightAmp = .65; }
      else if (state.evadeDir === 'up') { posY += .75 * bell; posZ = .14 * bell; rotX = -.46 * snap; leftAmp = 1.4; rightAmp = 1.4; }
      else if (state.evadeDir === 'down') { posY -= .72 * bell; posZ = .14 * bell; rotX = .48 * snap; leftAmp = .7; rightAmp = .7; }
      if (u >= 1) state.evadeDir = null;
    } else if (isFlying) {
      const normTurn = Math.max(-1, Math.min(1, flightTurn / .16)), normClimb = Math.max(-1, Math.min(1, flightClimb));
      rotZ = -normTurn * .32; rotX = -normClimb * .24;
      leftAmp = 1 + Math.max(0, normTurn) * .35 + Math.max(0, normClimb) * .25;
      rightAmp = 1 + Math.max(0, -normTurn) * .35 + Math.max(0, normClimb) * .25;
    }

    if (state.squashAmp > .001) {
      state.squashPhase += dt * 26; state.squashAmp *= Math.pow(.08, dt);
      const s = Math.sin(state.squashPhase) * state.squashAmp;
      deformGroup.scale.set(1 - s * .9, 1 + s * .65, 1 + s * .65);
    } else deformGroup.scale.set(1, 1, 1);

    const isPanic = state.blackEyeActive || state.crashPhase === 'falling', isEvade = Boolean(state.evadeDir);
    if (state.wingMode === 'idle' || isPanic || isEvade || isFlying) {
      const freq = (isPanic ? 38 : (isEvade ? 28 : (isFlying ? 24 : 16))) * state.flapSpeedMult;
      const wave = Math.sin(elapsed * freq), center = 24, amp = isPanic ? 22 : 26;
      const lDeg = center + wave * amp * leftAmp, rDeg = center + wave * amp * rightAmp;
      for (const w of wingPivots) {
        w.pivot.rotation.z = w.side * THREE.MathUtils.degToRad(w.side > 0 ? lDeg : rDeg);
      }
    } else {
      const rad = THREE.MathUtils.degToRad(state.wingAngleDeg);
      for (const w of wingPivots) w.pivot.rotation.z = w.side * rad;
    }
    animGroup.position.set(posX * UNIT, posY * UNIT, posZ * UNIT);
    animGroup.rotation.set(rotX, rotY, rotZ);
  }

  if (opts.wingScale) setWingScale(opts.wingScale);
  root.userData = {
    bodyMaterial: bodyMat, wingMaterial: wingMat, wingPivots, state, studioState: state,
    setWingScale, setColorDepth, setSubWingsVisible, setWingPose, setFlapSpeed,
    setBlackEyeLock, triggerBlackEyeImpact, triggerObstacleCrash, evade, updateStudio,
    designSource: 'meta-ai glb (assets/models/bee_meta_ai.glb); acquaintance reference art, permissioned'
  };
  return root;
}
