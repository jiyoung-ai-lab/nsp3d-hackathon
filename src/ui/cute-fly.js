// Hand-built Three.js character (cute baby fly look) — ESM port of assets/models/3d_cute_fly.html
// (user-supplied fly studio: pastel macaron stripe body, blush cheeks, glossy
// eyes, 4 heart wings, dizzy stars + impact-ring fx, evade/crash studio driver).
// Port notes: studio uses global THREE (r128); here THREE is injected (r160) so
// texture colorSpace replaces sRGBEncoding. Studio-only drivers (obstacle mesh,
// auto-dodge, raycast click, camera presets, UI) are dropped; crash starts at
// the falling phase like hand-drawn-pumpkin.js. Flying-lean terms (flyX/flyZ)
// follow the pumpkin port so all subjects bank the same way in flight.
// userData API matches createBee/createPumpkin so the subject panel drives it unchanged.

export function createCuteFly(THREE, opts = {}) {
  const root = new THREE.Group(), model = new THREE.Group(), animGroup = new THREE.Group(), deformGroup = new THREE.Group();
  model.add(animGroup); animGroup.add(deformGroup);

  function adjustHexRichness(hexStr, richnessMult) {
    const num = parseInt(hexStr.replace('#', ''), 16);
    let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    const darkFactor = Math.pow(1 / richnessMult, .82), luma = .299 * r + .587 * g + .114 * b, satBoost = 1 + (richnessMult - 1) * .65;
    r = (luma + (r - luma) * satBoost) * darkFactor; g = (luma + (g - luma) * satBoost) * darkFactor; b = (luma + (b - luma) * satBoost) * darkFactor;
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
  }
  function createFlyBodyStripeTexture(richnessMult = 1.15) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    ctx.fillStyle = adjustHexRichness('#bceeff', richnessMult); ctx.fillRect(0, 0, w, h);
    function drawBand(startRatio, endRatio, hexColor) {
      const x0 = Math.floor(startRatio * w), x1 = Math.ceil(endRatio * w), feather = 7;
      const col = adjustHexRichness(hexColor, richnessMult);
      ctx.fillStyle = col; ctx.fillRect(x0 + feather, 0, (x1 - x0) - feather * 2, h);
      const gradLeft = ctx.createLinearGradient(x0 - feather, 0, x0 + feather, 0);
      gradLeft.addColorStop(0, 'rgba(0,0,0,0)'); gradLeft.addColorStop(1, col);
      ctx.fillStyle = gradLeft; ctx.fillRect(x0 - feather, 0, feather * 2, h);
      const gradRight = ctx.createLinearGradient(x1 - feather, 0, x1 + feather, 0);
      gradRight.addColorStop(0, col); gradRight.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradRight; ctx.fillRect(x1 - feather, 0, feather * 2, h);
    }
    drawBand(0, .14, '#6d83d6'); drawBand(.13, .28, '#9ce2da'); drawBand(.27, .43, '#748add');
    drawBand(.42, .57, '#a7eae2'); drawBand(.56, .67, '#7c94e3'); drawBand(.66, 1, '#c2f0ff');
    const vertGrad = ctx.createLinearGradient(0, 0, 0, h);
    vertGrad.addColorStop(0, 'rgba(255, 255, 255, 0.20)'); vertGrad.addColorStop(.44, 'rgba(255, 255, 255, 0.0)');
    vertGrad.addColorStop(.78, 'rgba(42, 60, 108, 0.14)'); vertGrad.addColorStop(1, 'rgba(28, 42, 84, 0.28)');
    ctx.fillStyle = vertGrad; ctx.fillRect(0, 0, w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = -1; tex.offset.x = 1; tex.anisotropy = 16; tex.needsUpdate = true; return tex;
  }
  function createFlyWingGradientTexture(richnessMult = 1.15) {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, adjustHexRichness('#98ebe4', richnessMult)); grad.addColorStop(.48, adjustHexRichness('#c5e3ff', richnessMult));
    grad.addColorStop(.82, adjustHexRichness('#dfd0ff', richnessMult)); grad.addColorStop(1, adjustHexRichness('#eccbfc', richnessMult));
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; return tex;
  }
  function createHeartWingGeometry(length, maxWidth, thickness, side, isForewing = true) {
    const geom = new THREE.SphereGeometry(1, 44, 36), pos = geom.attributes.position, uv = geom.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const u = (y + 1) * .5;
      const chordScale = Math.pow(u, .25) * (.82 + .46 * u);
      const heartOffsetX = isForewing
        ? -maxWidth * (.48 * Math.pow(u, .72) - .12 * Math.pow(u, 2))
        : +maxWidth * (.42 * Math.pow(u, .78));
      const cleftIndent = Math.pow(u, 3.5) * Math.exp(-x * x * 9) * .11 * length;
      const thickScale = Math.pow(u, .22) * (.90 + .24 * u);
      const verticalLift = (.58 * thickness * thickScale) + .045 * Math.sin(u * Math.PI * .85);
      pos.setXYZ(i,
        x * maxWidth * chordScale + heartOffsetX,
        -side * z * thickness * thickScale + verticalLift,
        side * Math.max(0, u * length - cleftIndent));
      uv.setXY(i, (x + 1) * .5, u);
    }
    geom.computeVertexNormals(); return geom;
  }
  function createFlyBodyGeometry() {
    const geom = new THREE.SphereGeometry(1, 64, 48), pos = geom.attributes.position, uv = geom.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const frontBackProfile = 1 - .035 * x * (1 - y * y);
      const fx = x * 1.22, fy = y * .96 * frontBackProfile, fz = z * 1.04 * frontBackProfile;
      pos.setXYZ(i, fx, fy, fz);
      uv.setXY(i, THREE.MathUtils.clamp((fx / 1.22 + 1) * .5, .001, .999), THREE.MathUtils.clamp((1 - y) * .5, .001, .999));
    }
    geom.computeVertexNormals(); return geom;
  }

  const BODY_TOP_VERTEX = new THREE.Vector3(0, .96, 0), BASE_MAIN_SWEEP = .22, BASE_SUB_SWEEP = .32;
  const wingPivots = [], wingRoots = [], subWingPivots = [], subWingRoots = [], eyeMeshes = [], highlightGroups = [];

  const bodyMaterial = new THREE.MeshStandardMaterial({ map: createFlyBodyStripeTexture(.85), roughness: .55, metalness: 0, emissive: 0x2b3644, emissiveIntensity: .55 });
  const bodyMesh = new THREE.Mesh(createFlyBodyGeometry(), bodyMaterial);
  bodyMesh.name = 'Fly_Body'; bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
  deformGroup.add(bodyMesh);

  const cheekMat = new THREE.MeshStandardMaterial({ color: 0xffa2be, roughness: .42, metalness: 0 });
  const cheekGeom = new THREE.SphereGeometry(.165, 24, 24); cheekGeom.scale(.38, .62, 1.15);
  const leftCheekMesh = new THREE.Mesh(cheekGeom, cheekMat);
  leftCheekMesh.name = 'Fly_Blush_Left'; leftCheekMesh.position.set(-.95, -.24, .55);
  leftCheekMesh.rotation.y = -.45; leftCheekMesh.rotation.z = -.16; deformGroup.add(leftCheekMesh);
  const rightCheekMesh = new THREE.Mesh(cheekGeom, cheekMat);
  rightCheekMesh.name = 'Fly_Blush_Right'; rightCheekMesh.position.set(-.95, -.24, -.55);
  rightCheekMesh.rotation.y = .45; rightCheekMesh.rotation.z = -.16; deformGroup.add(rightCheekMesh);

  const eyeNormalMat = new THREE.MeshPhysicalMaterial({ color: 0x09090b, roughness: .07, metalness: .04, clearcoat: 1, clearcoatRoughness: .04 });
  const eyeBlackoutMat = new THREE.MeshStandardMaterial({ color: 0x020202, roughness: .98, metalness: 0 });
  const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  function createEyeUnit(isNearSide) {
    const eyeGroup = new THREE.Group();
    const sphereGeom = new THREE.SphereGeometry(.305, 36, 36); sphereGeom.scale(.85, 1.02, .94);
    const eyeMesh = new THREE.Mesh(sphereGeom, eyeNormalMat);
    eyeMesh.name = isNearSide ? 'Fly_Eye_Left' : 'Fly_Eye_Right'; eyeMesh.castShadow = true;
    eyeGroup.add(eyeMesh);
    const catchGroup = new THREE.Group();
    const hlMainGeom = new THREE.SphereGeometry(.072, 20, 20); hlMainGeom.scale(.62, 1, .85);
    const hlMain = new THREE.Mesh(hlMainGeom, highlightMat);
    hlMain.position.set(-.18, .12, isNearSide ? .19 : -.15); catchGroup.add(hlMain);
    const hlSub = new THREE.Mesh(new THREE.SphereGeometry(.028, 16, 16), highlightMat);
    hlSub.position.set(-.14, -.08, isNearSide ? .22 : -.18); catchGroup.add(hlSub);
    eyeGroup.add(catchGroup);
    return { eyeGroup, eyeMesh, catchGroup };
  }
  const leftEye = createEyeUnit(true); leftEye.eyeGroup.position.set(-.92, .06, .56); leftEye.eyeGroup.rotation.y = -.42; deformGroup.add(leftEye.eyeGroup);
  const rightEye = createEyeUnit(false); rightEye.eyeGroup.position.set(-.92, .06, -.56); rightEye.eyeGroup.rotation.y = .42; deformGroup.add(rightEye.eyeGroup);
  eyeMeshes.push({ eye: leftEye.eyeGroup, globe: leftEye.eyeMesh }, { eye: rightEye.eyeGroup, globe: rightEye.eyeMesh });
  highlightGroups.push(leftEye.catchGroup, rightEye.catchGroup);

  const wingMaterial = new THREE.MeshPhysicalMaterial({ map: createFlyWingGradientTexture(.85), color: 0xffffff, roughness: .30, metalness: 0, transparent: true, opacity: .95, clearcoat: .72, clearcoatRoughness: .15, emissive: 0x39404d, emissiveIntensity: .45 });
  function addWingPair(isMain, geomL, geomR, nameL, nameR) {
    const mk = (side, geom, name, sweep) => {
      const rootW = new THREE.Group(), pivot = new THREE.Group();
      rootW.position.copy(BODY_TOP_VERTEX); rootW.rotation.y = sweep;
      const mesh = new THREE.Mesh(geom, wingMaterial);
      mesh.name = name; mesh.castShadow = true; pivot.add(mesh); rootW.add(pivot); deformGroup.add(rootW);
      return { pivot, rootW, side };
    };
    if (isMain) {
      const L = mk(1, geomL, nameL, -BASE_MAIN_SWEEP), R = mk(-1, geomR, nameR, BASE_MAIN_SWEEP);
      wingPivots.push(L, R); wingRoots.push(L.rootW, R.rootW);
    } else {
      const L = mk(1, geomL, nameL, BASE_SUB_SWEEP), R = mk(-1, geomR, nameR, -BASE_SUB_SWEEP);
      subWingPivots.push(L, R); subWingRoots.push(L.rootW, R.rootW);
    }
  }
  addWingPair(true,
    createHeartWingGeometry(1.44, .55, .165, 1, true), createHeartWingGeometry(1.44, .55, .165, -1, true),
    'Fly_Wing_Main_Left', 'Fly_Wing_Main_Right');
  addWingPair(false,
    createHeartWingGeometry(.98, .41, .140, 1, false), createHeartWingGeometry(.98, .41, .140, -1, false),
    'Fly_Wing_Sub_Left', 'Fly_Wing_Sub_Right');

  const dizzyStarsGroup = new THREE.Group(); dizzyStarsGroup.position.set(-.45, 1.35, 0); dizzyStarsGroup.visible = false; deformGroup.add(dizzyStarsGroup);
  const starMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  for (let i = 0; i < 4; i++) { const ang = (i / 4) * Math.PI * 2, star = new THREE.Mesh(new THREE.OctahedronGeometry(.10, 0), starMat); star.position.set(Math.cos(ang) * .52, 0, Math.sin(ang) * .52); dizzyStarsGroup.add(star); }

  const ringMat = new THREE.MeshBasicMaterial({ color: 0x18181b, side: THREE.DoubleSide, transparent: true, opacity: 0 });
  const impactRing = new THREE.Mesh(new THREE.RingGeometry(.18, .28, 36), ringMat);
  impactRing.position.set(-1.30, .08, 0); impactRing.rotation.y = Math.PI / 2; deformGroup.add(impactRing);

  const state = {
    wingMode: 'idle', wingAngleDeg: 26, wingScale: 1, flapSpeedMult: 1, jiggleStrength: 1, colorDepth: .85,
    blackEyeActive: false, blackEyeLocked: false, blackEyeTimer: 0,
    velX: 0, velY: 0, dispX: 0, dispY: 0, squashPhase: 0, squashAmp: 0, ringTimer: 0,
    crashPhase: 'none', crashTimer: 0, spiralX: 0, spiralY: 0, spiralZ: 0, spiralYaw: 0, spiralRoll: 0, spiralPitch: 0,
    evadeDir: null, evadeTimer: 0, evadeDuration: .68, evadePos: new THREE.Vector3(), evadeRoll: 0, evadeYaw: 0, evadePitch: 0,
    wingSteerLeftAmp: 1, wingSteerRightAmp: 1, wingSteerSweepOffset: 0, wingSteerPitchOffset: 0,
  };

  function applyEyeAppearance(isBlackout) {
    const mat = isBlackout ? eyeBlackoutMat : eyeNormalMat;
    for (const { eye, globe } of eyeMeshes) { globe.material = mat; eye.scale.setScalar(isBlackout ? 1.09 : 1); }
    for (const g of highlightGroups) g.visible = !isBlackout;
  }
  function setWingScale(mult) {
    state.wingScale = THREE.MathUtils.clamp(Number(mult) || 1, .5, 2);
    for (const r of [...wingRoots, ...subWingRoots]) { r.scale.setScalar(state.wingScale); r.position.copy(BODY_TOP_VERTEX); }
    return state.wingScale;
  }
  function setColorDepth(mult) {
    state.colorDepth = Math.max(.8, Math.min(1.5, Number(mult) || 1.15));
    if (bodyMaterial.map) bodyMaterial.map.dispose();
    bodyMaterial.map = createFlyBodyStripeTexture(state.colorDepth); bodyMaterial.needsUpdate = true;
    if (wingMaterial.map) wingMaterial.map.dispose();
    wingMaterial.map = createFlyWingGradientTexture(state.colorDepth); wingMaterial.needsUpdate = true;
  }
  function setSubWingsVisible(visible) {
    const v = Boolean(visible);
    for (const r of subWingRoots) r.visible = v;
    leftCheekMesh.visible = v; rightCheekMesh.visible = v;
  }
  function setWingPose(mode = 'idle', angleDeg = 26) {
    state.wingMode = mode;
    if (Number.isFinite(Number(angleDeg))) state.wingAngleDeg = Math.max(6, Number(angleDeg));
  }
  function setFlapSpeed(mult) { state.flapSpeedMult = Math.max(0, Math.min(2.5, Number(mult) ?? 1)); }
  function setBlackEyeLock(locked) {
    state.blackEyeLocked = Boolean(locked);
    state.blackEyeActive = state.blackEyeLocked;
    applyEyeAppearance(state.blackEyeActive);
  }
  function triggerBlackEyeImpact(duration = 2.2) {
    state.blackEyeActive = true; state.blackEyeTimer = Math.max(.55, Number(duration) || 2.2); applyEyeAppearance(true);
    const mult = state.jiggleStrength;
    state.velX = 3.2 * mult; state.velY = 1 * mult;
    state.squashAmp = .18 * mult; state.squashPhase = 0; state.ringTimer = .9;
  }
  function triggerObstacleCrash() {
    state.evadeDir = null; state.evadeTimer = 0;
    state.crashPhase = 'falling'; state.crashTimer = 0;
    state.blackEyeActive = true; applyEyeAppearance(true);
    dizzyStarsGroup.visible = true;
    state.velX = 3.2; state.velY = 1;
    state.squashAmp = .22; state.squashPhase = 0; state.ringTimer = 1;
  }
  function evade(dir) {
    if (state.crashPhase === 'falling') return;
    state.evadeDir = dir; state.evadeTimer = 0;
  }
  function updateStudio(dt, nowMs, isFlying = false, flightTurn = 0, flightClimb = 0) {
    const elapsed = nowMs * .001;
    if (state.blackEyeActive && !state.blackEyeLocked && state.crashPhase === 'none') {
      state.blackEyeTimer -= dt;
      if (state.blackEyeTimer <= 0) { state.blackEyeActive = false; applyEyeAppearance(false); }
    }
    if (state.crashPhase === 'falling') {
      state.crashTimer += dt;
      const p = Math.min(1, state.crashTimer / 2.15);
      const turns = p * Math.PI * 2 * 3.5, spiralRadius = .42 * Math.sin(p * Math.PI);
      state.spiralX = Math.cos(turns) * spiralRadius; state.spiralZ = Math.sin(turns) * spiralRadius;
      state.spiralY = p < .82 ? -1.15 * Math.pow(p / .82, 1.45) : -1.15 + Math.sin(((p - .82) / .18) * Math.PI) * .18;
      state.spiralYaw = turns; state.spiralPitch = .35 * Math.sin(p * Math.PI); state.spiralRoll = .28 * Math.cos(turns * .5);
      dizzyStarsGroup.rotation.y = elapsed * 10; dizzyStarsGroup.rotation.z = Math.sin(elapsed * 8) * .16;
      if (p >= 1) { state.crashPhase = 'recover'; state.crashTimer = 0; }
    } else if (state.crashPhase === 'recover') {
      state.crashTimer += dt;
      const r = Math.min(1, state.crashTimer / .65), ease = 1 - Math.pow(1 - r, 3);
      state.spiralX = THREE.MathUtils.lerp(state.spiralX, 0, ease);
      state.spiralY = THREE.MathUtils.lerp(-1.15, 0, ease);
      state.spiralZ = THREE.MathUtils.lerp(state.spiralZ, 0, ease);
      state.spiralYaw = THREE.MathUtils.lerp(state.spiralYaw % (Math.PI * 2), 0, ease);
      state.spiralPitch = THREE.MathUtils.lerp(state.spiralPitch, 0, ease);
      state.spiralRoll = THREE.MathUtils.lerp(state.spiralRoll, 0, ease);
      if (r >= 1) {
        state.crashPhase = 'none';
        state.spiralX = 0; state.spiralY = 0; state.spiralZ = 0; state.spiralYaw = 0; state.spiralPitch = 0; state.spiralRoll = 0;
        dizzyStarsGroup.visible = false;
        if (!state.blackEyeLocked) { state.blackEyeActive = false; applyEyeAppearance(false); }
      }
    }

    state.wingSteerLeftAmp = 1; state.wingSteerRightAmp = 1;
    state.wingSteerSweepOffset = 0; state.wingSteerPitchOffset = 0;
    let flyX = 0, flyZ = 0;
    if (state.evadeDir) {
      state.evadeTimer += dt;
      const u = Math.min(1, state.evadeTimer / state.evadeDuration), bell = Math.sin(u * Math.PI), snap = Math.sin(Math.pow(u, .7) * Math.PI);
      if (state.evadeDir === 'left') { state.evadePos.set(0, .12 * bell, 1.15 * bell); state.evadeRoll = -.60 * snap; state.evadeYaw = -.45 * snap; state.evadePitch = -.10 * snap; state.wingSteerLeftAmp = .65; state.wingSteerRightAmp = 1.45; state.wingSteerSweepOffset = .22 * snap; }
      else if (state.evadeDir === 'right') { state.evadePos.set(0, .12 * bell, -1.15 * bell); state.evadeRoll = .60 * snap; state.evadeYaw = .45 * snap; state.evadePitch = -.10 * snap; state.wingSteerLeftAmp = 1.45; state.wingSteerRightAmp = .65; state.wingSteerSweepOffset = -.22 * snap; }
      else if (state.evadeDir === 'up') { state.evadePos.set(-.18 * bell, .92 * bell, 0); state.evadeRoll = 0; state.evadeYaw = 0; state.evadePitch = -.50 * snap; state.wingSteerLeftAmp = 1.40; state.wingSteerRightAmp = 1.40; state.wingSteerPitchOffset = .28 * snap; }
      else if (state.evadeDir === 'down') { state.evadePos.set(-.18 * bell, -.88 * bell, 0); state.evadeRoll = 0; state.evadeYaw = 0; state.evadePitch = .52 * snap; state.wingSteerLeftAmp = .70; state.wingSteerRightAmp = .70; state.wingSteerPitchOffset = -.32 * snap; }
      if (u >= 1) { state.evadeDir = null; state.evadePos.set(0, 0, 0); state.evadeRoll = 0; state.evadeYaw = 0; state.evadePitch = 0; }
    } else if (isFlying && state.crashPhase === 'none') {
      const normTurn = Math.max(-1, Math.min(1, flightTurn / .16)), normClimb = Math.max(-1, Math.min(1, flightClimb));
      flyX = normTurn * .32; flyZ = -normClimb * .24;
      state.wingSteerLeftAmp = 1 + Math.max(0, normTurn) * .35 + Math.max(0, normClimb) * .25;
      state.wingSteerRightAmp = 1 + Math.max(0, -normTurn) * .35 + Math.max(0, normClimb) * .25;
      state.wingSteerSweepOffset = -normTurn * .12; state.wingSteerPitchOffset = normClimb * .14;
    }

    if (state.wingMode === 'idle' || state.crashPhase !== 'none' || state.evadeDir || isFlying) {
      const isPanic = state.blackEyeActive || state.crashPhase === 'falling', isEvading = Boolean(state.evadeDir);
      const freq = (isPanic ? 38 : (isEvading ? 28 : (isFlying ? 30 : 19))) * state.flapSpeedMult;
      const wave = Math.sin(elapsed * freq), amp = isPanic ? 22 : 26;
      const lDeg = 24 + wave * amp * state.wingSteerLeftAmp;
      const rDeg = 24 + wave * amp * state.wingSteerRightAmp;
      for (const w of wingPivots) {
        const deg = w.side > 0 ? lDeg : rDeg;
        w.pivot.rotation.x = -w.side * THREE.MathUtils.degToRad(deg);
        w.pivot.rotation.z = (state.evadeRoll + flyX) * .35;
        w.rootW.rotation.y = (w.side > 0 ? -BASE_MAIN_SWEEP : BASE_MAIN_SWEEP) + state.wingSteerSweepOffset - w.side * state.wingSteerPitchOffset;
      }
      for (const w of subWingPivots) {
        const deg = (w.side > 0 ? lDeg : rDeg) * .76;
        w.pivot.rotation.x = -w.side * THREE.MathUtils.degToRad(deg);
        w.rootW.rotation.y = (w.side > 0 ? BASE_SUB_SWEEP : -BASE_SUB_SWEEP) + state.wingSteerSweepOffset * .8 - w.side * state.wingSteerPitchOffset * .6;
      }
    } else {
      const rad = THREE.MathUtils.degToRad(Math.max(6, state.wingAngleDeg));
      for (const w of wingPivots) {
        w.pivot.rotation.x = -w.side * rad;
        w.pivot.rotation.z = 0;
        w.rootW.rotation.y = w.side > 0 ? -BASE_MAIN_SWEEP : BASE_MAIN_SWEEP;
      }
      for (const w of subWingPivots) {
        w.pivot.rotation.x = -w.side * rad * .76;
        w.rootW.rotation.y = w.side > 0 ? BASE_SUB_SWEEP : -BASE_SUB_SWEEP;
      }
    }

    const hoverY = state.wingMode === 'idle' && state.crashPhase === 'none' ? Math.sin(elapsed * 3.2) * .09 : Math.sin(elapsed * 1.6) * .03;
    const hoverPitch = state.wingMode === 'idle' && state.crashPhase === 'none' ? Math.cos(elapsed * 3.2) * .035 : 0;
    state.velX += (-140 * state.dispX - 10 * state.velX) * dt;
    state.velY += (-140 * state.dispY - 10 * state.velY) * dt;
    state.dispX += state.velX * dt; state.dispY += state.velY * dt;
    const stunJitterX = state.blackEyeActive && state.squashAmp > .03 ? Math.sin(elapsed * 75) * .032 * state.squashAmp : 0;
    animGroup.position.set(
      state.dispX + stunJitterX + state.evadePos.x + state.spiralX,
      hoverY + state.dispY + state.evadePos.y + state.spiralY,
      state.evadePos.z + state.spiralZ
    );
    animGroup.rotation.set(
      state.evadeRoll + state.spiralRoll + flyX,
      state.evadeYaw + state.spiralYaw,
      hoverPitch - state.dispX * .35 + state.evadePitch + state.spiralPitch + flyZ
    );

    if (state.squashAmp > .001) {
      state.squashPhase += dt * 26; state.squashAmp *= Math.pow(.08, dt);
      const s = Math.sin(state.squashPhase) * state.squashAmp;
      deformGroup.scale.set(1 - s * .85, 1 + s * .62, 1 + s * .62);
    } else deformGroup.scale.set(1, 1, 1);

    if (state.ringTimer > 0) {
      state.ringTimer = Math.max(0, state.ringTimer - dt * 2.5);
      const sc = 1 + (1 - state.ringTimer) * 4;
      impactRing.scale.set(sc, sc, 1);
      ringMat.opacity = state.ringTimer * .5;
    } else ringMat.opacity = 0;
  }

  model.rotation.y = -Math.PI / 2; model.scale.setScalar(.00333); root.add(model);
  if (opts.wingScale) setWingScale(opts.wingScale);
  root.userData = {
    bodyMaterial, wingMaterial, wingPivots, state, studioState: state,
    setWingScale, setColorDepth, setSubWingsVisible, setWingPose, setFlapSpeed,
    setBlackEyeLock, triggerBlackEyeImpact, triggerObstacleCrash, evade, updateStudio,
    designSource: 'user-supplied hand-built fly geometry (3d_cute_fly studio)'
  };
  return root;
}

export const createHandDrawnCuteFly = createCuteFly;
