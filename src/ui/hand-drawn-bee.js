// Hand-built Three.js character (honeybee look) — ESM port of reference/samplesource/assets/hand-drawn-bee.js (filename kept)
// (user-supplied 3d_4 studio geometry: stripe-textured body, heart-shaped wings,
// compound eyes, dizzy stars + shock-ring impact fx, evade/crash studio driver).
// Port notes: sample uses global THREE/window; here THREE is injected and the
// factory honors an initial opts.wingScale. All geometry, state names, userData
// API and updateStudio() behavior are sample-identical.

export function createBee(THREE, opts = {}) {
  const root = new THREE.Group(), model = new THREE.Group(), animGroup = new THREE.Group(), deformGroup = new THREE.Group(), wingPivots = [], wingRoots = [], subWingRoots = [], eyeMeshes = [], highlightGroups = [];
  model.add(animGroup); animGroup.add(deformGroup);

  function adjustHexRichness(hexStr, richnessMult) {
    const num = parseInt(hexStr.replace('#', ''), 16);
    let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    const darkFactor = Math.pow(1 / richnessMult, .85), luma = .299 * r + .587 * g + .114 * b, satBoost = 1 + (richnessMult - 1) * .65;
    r = (luma + (r - luma) * satBoost) * darkFactor; g = (luma + (g - luma) * satBoost) * darkFactor; b = (luma + (b - luma) * satBoost) * darkFactor;
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
  }
  function buildStripeTexture(richnessMult = 1.15) {
    const stripeCanvas = document.createElement('canvas'); stripeCanvas.width = 1024; stripeCanvas.height = 512;
    const ctx = stripeCanvas.getContext('2d'); ctx.fillStyle = adjustHexRichness('#dab022', richnessMult); ctx.fillRect(0, 0, 1024, 512);
    for (const [a, b, hex] of [[0, .13, '#c2541c'], [.12, .27, '#3f1f0c'], [.26, .43, '#d17e16'], [.42, .60, '#cf5914'], [.59, 1, '#dab022']]) {
      const x = Math.floor(a * 1024), w = Math.ceil((b - a) * 1024), c = adjustHexRichness(hex, richnessMult);
      ctx.fillStyle = c; ctx.fillRect(x + 6, 0, w - 12, 512);
      const g1 = ctx.createLinearGradient(x - 6, 0, x + 6, 0); g1.addColorStop(0, 'rgba(0,0,0,0)'); g1.addColorStop(1, c); ctx.fillStyle = g1; ctx.fillRect(x - 6, 0, 12, 512);
      const g2 = ctx.createLinearGradient(x + w - 6, 0, x + w + 6, 0); g2.addColorStop(0, c); g2.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g2; ctx.fillRect(x + w - 6, 0, 12, 512);
    }
    const shade = ctx.createLinearGradient(0, 0, 0, 512); shade.addColorStop(0, 'rgba(255,244,195,.10)'); shade.addColorStop(.42, 'rgba(0,0,0,0)'); shade.addColorStop(.76, 'rgba(65,25,0,.18)'); shade.addColorStop(1, 'rgba(45,16,0,.36)'); ctx.fillStyle = shade; ctx.fillRect(0, 0, 1024, 512);
    const tex = new THREE.CanvasTexture(stripeCanvas); tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(-1, 1); tex.offset.set(1, 0); tex.needsUpdate = true; return tex;
  }
  function buildWingTexture(richnessMult = 1.15) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256; const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, adjustHexRichness('#5699b5', richnessMult)); grad.addColorStop(.55, adjustHexRichness('#73b7cf', richnessMult)); grad.addColorStop(1, adjustHexRichness('#8ac9de', richnessMult));
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c); tex.needsUpdate = true; return tex;
  }

  const bodyMaterial = new THREE.MeshStandardMaterial({ map: buildStripeTexture(1.15), color: 0xffffff, roughness: .52, metalness: .01, emissive: 0x000000, emissiveIntensity: 0 });
  const wingMaterial = new THREE.MeshPhysicalMaterial({ map: buildWingTexture(1.15), color: 0xffffff, transparent: true, opacity: .92, roughness: .26, metalness: 0, clearcoat: .55, clearcoatRoughness: .18, side: THREE.DoubleSide, depthWrite: false });
  const eyeNormalMat = new THREE.MeshPhysicalMaterial({ color: 0x09090b, roughness: .08, metalness: .04, clearcoat: 1, clearcoatRoughness: .05 });
  const eyeBlackoutMat = new THREE.MeshStandardMaterial({ color: 0x020202, roughness: .98, metalness: 0 });
  const highlightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x3e4148, roughness: .48, metalness: .12 });

  const bodyGeometry = new THREE.SphereGeometry(1, 48, 36), p = bodyGeometry.attributes.position, uv = bodyGeometry.attributes.uv;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), profile = 1 - .04 * x * (1 - y * y); p.setXYZ(i, x * 1.36, y * .96 * profile, z * 1.02 * profile); uv.setXY(i, THREE.MathUtils.clamp((x + 1) * .5, .001, .999), THREE.MathUtils.clamp((1 - y) * .5, .001, .999)); } bodyGeometry.computeVertexNormals();
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial); body.name = 'Bee_Body'; body.castShadow = true; deformGroup.add(body);

  const stingerGeo = new THREE.ConeGeometry(.16, .42, 24); stingerGeo.rotateZ(-Math.PI / 2); const stinger = new THREE.Mesh(stingerGeo, darkMaterial); stinger.name = 'Bee_Stinger'; stinger.position.set(1.42, -.02, 0); stinger.castShadow = true; deformGroup.add(stinger);

  for (const side of [1, -1]) {
    const eye = new THREE.Group(); eye.position.set(-1.02, .02, side * .62); eye.rotation.y = -side * .42;
    const globe = new THREE.Mesh(new THREE.SphereGeometry(.30, 28, 22), eyeNormalMat); globe.scale.set(.85, 1, .92); globe.name = side > 0 ? 'Bee_Eye_Left' : 'Bee_Eye_Right'; globe.castShadow = true;
    const hlGroup = new THREE.Group();
    const shine = new THREE.Mesh(new THREE.SphereGeometry(.068, 14, 10), highlightMaterial); shine.scale.set(.62, 1, .85); shine.position.set(-.18, .11, side > 0 ? .19 : -.15);
    const shine2 = new THREE.Mesh(new THREE.SphereGeometry(.026, 10, 8), highlightMaterial); shine2.position.set(-.14, -.08, side > 0 ? .22 : -.18);
    hlGroup.add(shine, shine2); eye.add(globe, hlGroup); deformGroup.add(eye);
    eyeMeshes.push({ eye, globe }); highlightGroups.push(hlGroup);
  }

  function heartWing(length, width, thickness, side, fore) {
    const geom = new THREE.SphereGeometry(1, 36, 28), pos = geom.attributes.position, uvs = geom.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), u = (y + 1) * .5, chord = Math.pow(u, .25) * (.80 + .45 * u), offset = fore ? -width * (.48 * Math.pow(u, .72) - .12 * Math.pow(u, 2)) : width * .42 * Math.pow(u, .78), thick = Math.pow(u, .22) * (.88 + .22 * u), lift = .58 * thickness * thick + .042 * Math.sin(u * Math.PI * .85);
      pos.setXYZ(i, x * width * chord + offset, -side * z * thickness * thick + lift, side * u * length); uvs.setXY(i, (x + 1) * .5, u);
    }
    geom.computeVertexNormals(); return geom;
  }

  const anchor = new THREE.Vector3(0, .96, 0), BASE_MAIN_SWEEP = .22, BASE_SUB_SWEEP = .32;
  for (const side of [1, -1]) for (const fore of [true, false]) {
    const rootWing = new THREE.Group(), pivot = new THREE.Group();
    rootWing.position.copy(anchor);
    const baseSweep = side * (fore ? -BASE_MAIN_SWEEP : BASE_SUB_SWEEP);
    rootWing.rotation.y = baseSweep;
    const length = fore ? 1.488 : 1.008, width = fore ? .54 : .408, thick = fore ? .162 : .138;
    const mesh = new THREE.Mesh(heartWing(length, width, thick, side, fore), wingMaterial);
    mesh.name = fore ? (side > 0 ? 'Bee_Wing_Main_Left' : 'Bee_Wing_Main_Right') : (side > 0 ? 'Bee_Wing_Sub_Left' : 'Bee_Wing_Sub_Right');
    mesh.castShadow = true; pivot.add(mesh); rootWing.add(pivot); deformGroup.add(rootWing);
    wingPivots.push({ pivot, rootWing, side, fore, baseSweep });
    wingRoots.push(rootWing);
    if (!fore) subWingRoots.push(rootWing);
  }

  // Dizzy stars overhead during obstacle collision / spiraling crash
  const dizzyStarsGroup = new THREE.Group(); dizzyStarsGroup.position.set(-.55, 1.38, 0); dizzyStarsGroup.visible = false; deformGroup.add(dizzyStarsGroup);
  const starMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  for (let i = 0; i < 4; i++) { const ang = (i / 4) * Math.PI * 2, star = new THREE.Mesh(new THREE.OctahedronGeometry(.13, 0), starMat); star.position.set(Math.cos(ang) * .58, 0, Math.sin(ang) * .58); dizzyStarsGroup.add(star); }

  // Impact shock ring around the agent when colliding with a maze wall/hazard
  const shockRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.45, .075, 10, 28),
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
    const mat = isBlack ? eyeBlackoutMat : eyeNormalMat, sc = isBlack ? 1.09 : 1;
    for (const { eye, globe } of eyeMeshes) { globe.material = mat; eye.scale.setScalar(sc); }
    for (const g of highlightGroups) g.visible = !isBlack;
  }
  function setWingScale(mult) {
    state.wingScale = Math.max(.5, Math.min(2, Number(mult) || 1));
    for (const r of wingRoots) r.scale.setScalar(state.wingScale);
    return state.wingScale;
  }
  function setColorDepth(mult) {
    state.colorDepth = Math.max(.8, Math.min(1.5, Number(mult) || 1.15));
    if (bodyMaterial.map) bodyMaterial.map.dispose();
    bodyMaterial.map = buildStripeTexture(state.colorDepth); bodyMaterial.needsUpdate = true;
    if (wingMaterial.map) wingMaterial.map.dispose();
    wingMaterial.map = buildWingTexture(state.colorDepth); wingMaterial.needsUpdate = true;
  }
  function setSubWingsVisible(visible) { for (const r of subWingRoots) r.visible = Boolean(visible); }
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
      bodyMaterial.emissive.setHex(0xef4444);
      bodyMaterial.emissiveIntensity = pulse * .72;
      shockRing.scale.setScalar(.85 + (1 - pulse) * 1.35);
      shockRing.material.opacity = pulse * .85;
      if (state.impactFlashTimer <= 0) {
        bodyMaterial.emissiveIntensity = 0;
        shockRing.visible = false;
      }
    }
    let posX = 0, posY = state.wingMode === 'idle' && state.crashPhase === 'none' ? Math.sin(elapsed * 3.2) * .06 : 0, posZ = 0;
    let rotX = 0, rotY = 0, rotZ = state.wingMode === 'idle' && state.crashPhase === 'none' ? Math.cos(elapsed * 3.2) * .03 : 0;
    let leftAmp = 1, rightAmp = 1, sweepOff = 0, pitchOff = 0;

    if (state.crashPhase === 'falling') {
      state.crashTimer += dt;
      const p = Math.min(1, state.crashTimer / 1.65), turns = p * Math.PI * 2 * 3.5, radius = .38 * Math.sin(p * Math.PI);
      posX = Math.cos(turns) * radius; posZ = Math.sin(turns) * radius;
      posY = p < .8 ? -.95 * Math.pow(p / .8, 1.4) : -0.95 * (1 - (p - .8) / .2);
      rotY = turns; rotZ = .38 * Math.sin(p * Math.PI); rotX = .32 * Math.cos(turns * .5);
      dizzyStarsGroup.rotation.y = elapsed * 10; dizzyStarsGroup.rotation.z = Math.sin(elapsed * 8) * .18;
      if (p >= 1) { state.crashPhase = 'none'; dizzyStarsGroup.visible = false; if (!state.blackEyeLocked) { state.blackEyeActive = false; setBlackEye(false); } }
    } else if (state.impactFlashTimer > .05) {
      // Visible stun wobble when colliding with a wall or obstacle during maze flight
      const wobble = state.impactFlashTimer / .52;
      posX = -.28 * wobble;
      rotY = Math.sin(elapsed * 48) * .38 * wobble;
      rotZ = Math.cos(elapsed * 42) * .28 * wobble;
      rotX = Math.sin(elapsed * 36) * .32 * wobble;
    } else if (state.evadeDir) {
      state.evadeTimer += dt;
      const u = Math.min(1, state.evadeTimer / state.evadeDuration), bell = Math.sin(u * Math.PI), snap = Math.sin(Math.pow(u, .7) * Math.PI);
      if (state.evadeDir === 'left') { posZ = .85 * bell; posY += .10 * bell; rotX = -.55 * snap; rotY = -.38 * snap; leftAmp = .65; rightAmp = 1.45; sweepOff = .22 * snap; }
      else if (state.evadeDir === 'right') { posZ = -.85 * bell; posY += .10 * bell; rotX = .55 * snap; rotY = .38 * snap; leftAmp = 1.45; rightAmp = .65; sweepOff = -.22 * snap; }
      else if (state.evadeDir === 'up') { posY += .75 * bell; posX = -.14 * bell; rotZ = -.46 * snap; leftAmp = 1.4; rightAmp = 1.4; pitchOff = .26 * snap; }
      else if (state.evadeDir === 'down') { posY -= .72 * bell; posX = -.14 * bell; rotZ = .48 * snap; leftAmp = .7; rightAmp = .7; pitchOff = -.28 * snap; }
      if (u >= 1) state.evadeDir = null;
    } else if (isFlying) {
      // Subtle live flight banking & asymmetric wing amplitude from neural/camera steering
      const normTurn = Math.max(-1, Math.min(1, flightTurn / .16)), normClimb = Math.max(-1, Math.min(1, flightClimb));
      rotX = normTurn * .32; rotZ = -normClimb * .24;
      leftAmp = 1 + Math.max(0, normTurn) * .35 + Math.max(0, normClimb) * .25;
      rightAmp = 1 + Math.max(0, -normTurn) * .35 + Math.max(0, normClimb) * .25;
      sweepOff = -normTurn * .12; pitchOff = normClimb * .14;
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
        const deg = w.side > 0 ? lDeg : rDeg, factor = w.fore ? 1 : .76;
        w.pivot.rotation.x = -w.side * THREE.MathUtils.degToRad(deg * factor);
        w.pivot.rotation.z = rotX * .35;
        w.rootWing.rotation.y = w.baseSweep + sweepOff * (w.fore ? 1 : .8) + w.side * pitchOff * (w.fore ? -1 : -.6);
      }
    } else {
      const rad = THREE.MathUtils.degToRad(state.wingAngleDeg);
      for (const w of wingPivots) {
        w.pivot.rotation.x = -w.side * rad * (w.fore ? 1 : .76);
        w.pivot.rotation.z = 0;
        w.rootWing.rotation.y = w.baseSweep;
      }
    }
    animGroup.position.set(posX, posY, posZ);
    animGroup.rotation.set(rotX, rotY, rotZ);
  }

  model.rotation.y = -Math.PI / 2; model.scale.setScalar(.00333); root.add(model);
  if (opts.wingScale) setWingScale(opts.wingScale);
  root.userData = {
    bodyMaterial, wingMaterial, wingPivots, state, studioState: state,
    setWingScale, setColorDepth, setSubWingsVisible, setWingPose, setFlapSpeed,
    setBlackEyeLock, triggerBlackEyeImpact, triggerObstacleCrash, evade, updateStudio,
    designSource: 'user-supplied hand-built bee geometry (3d_4 studio)'
  };
  return root;
}

export const createHandDrawnBee = createBee;
