// Hand-built Three.js character (pumpkin look) — ESM port of assets/models/3d_pumpkin.html
// (user-supplied pumpkin studio: 4-rib sculpted body, top-vertex leaf wings,
// glossy eyes, dizzy stars + impact-ring fx, evade/crash studio driver).
// Port notes: studio uses global THREE (r128); here THREE is injected (r160) so
// texture colorSpace replaces sRGBEncoding. Studio-only drivers (obstacle,
// auto-dodge, raycast click, camera presets, UI) are dropped; crash starts at
// the falling phase like hand-drawn-bee.js. Geometry resolutions follow the
// studio's own NSP snippet (body 96x72, leaf 40x32). userData API matches
// createBee/createHoneybee2 so the subject panel drives it unchanged.

export function createPumpkin(THREE, opts = {}) {
  const root = new THREE.Group(), model = new THREE.Group(), animGroup = new THREE.Group(), deformGroup = new THREE.Group();
  model.add(animGroup); animGroup.add(deformGroup);

  function adjustHexRichness(hexStr, richnessMult) {
    const num = parseInt(hexStr.replace('#', ''), 16);
    let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    const darkFactor = Math.pow(1 / richnessMult, .78), luma = .299 * r + .587 * g + .114 * b, satBoost = 1 + (richnessMult - 1) * .70;
    r = (luma + (r - luma) * satBoost) * darkFactor; g = (luma + (g - luma) * satBoost) * darkFactor; b = (luma + (b - luma) * satBoost) * darkFactor;
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
  }
  function createPumpkinBodyTexture(richnessMult = 1.15) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    const baseGrad = ctx.createLinearGradient(0, 0, 0, h);
    baseGrad.addColorStop(0, adjustHexRichness('#df5b12', richnessMult));
    baseGrad.addColorStop(.14, adjustHexRichness('#ff9d2e', richnessMult));
    baseGrad.addColorStop(.45, adjustHexRichness('#f77211', richnessMult));
    baseGrad.addColorStop(.78, adjustHexRichness('#e05309', richnessMult));
    baseGrad.addColorStop(1, adjustHexRichness('#9e3004', richnessMult));
    ctx.fillStyle = baseGrad; ctx.fillRect(0, 0, w, h);
    for (const cu of [0, .25, .50, .75, 1]) {
      const cx = cu * w, rad = w * .105;
      const hl = ctx.createRadialGradient(cx, h * .44, rad * .05, cx, h * .48, rad);
      hl.addColorStop(0, 'rgba(255, 228, 115, 0.48)'); hl.addColorStop(.55, 'rgba(255, 185, 60, 0.18)'); hl.addColorStop(1, 'rgba(255, 160, 40, 0.0)');
      ctx.fillStyle = hl; ctx.fillRect(cx - rad, 0, rad * 2, h);
    }
    for (const gu of [.125, .375, .625, .875]) {
      const gx = gu * w, gw = w * .058;
      const gr = ctx.createLinearGradient(gx - gw, 0, gx + gw, 0);
      gr.addColorStop(0, 'rgba(92, 26, 4, 0.0)'); gr.addColorStop(.32, 'rgba(115, 34, 6, 0.45)'); gr.addColorStop(.5, 'rgba(58, 15, 2, 0.82)');
      gr.addColorStop(.68, 'rgba(115, 34, 6, 0.45)'); gr.addColorStop(1, 'rgba(92, 26, 4, 0.0)');
      ctx.fillStyle = gr; ctx.fillRect(gx - gw, 0, gw * 2, h);
    }
    const topShadow = ctx.createLinearGradient(0, 0, 0, h * .09);
    topShadow.addColorStop(0, 'rgba(65, 20, 4, 0.55)'); topShadow.addColorStop(1, 'rgba(65, 20, 4, 0.0)');
    ctx.fillStyle = topShadow; ctx.fillRect(0, 0, w, h * .09);
    const botShadow = ctx.createLinearGradient(0, h * .90, 0, h);
    botShadow.addColorStop(0, 'rgba(55, 16, 3, 0.0)'); botShadow.addColorStop(1, 'rgba(55, 16, 3, 0.65)');
    ctx.fillStyle = botShadow; ctx.fillRect(0, h * .90, w, h * .10);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 16; tex.needsUpdate = true; return tex;
  }
  function createLeafWingTexture(richnessMult = 1.15) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, adjustHexRichness('#2f7a32', richnessMult)); grad.addColorStop(.22, adjustHexRichness('#439e41', richnessMult));
    grad.addColorStop(.65, adjustHexRichness('#5ec255', richnessMult)); grad.addColorStop(1, adjustHexRichness('#82db73', richnessMult));
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    const edgeGrad = ctx.createLinearGradient(0, 0, w, 0);
    edgeGrad.addColorStop(0, 'rgba(20, 68, 24, 0.38)'); edgeGrad.addColorStop(.2, 'rgba(20, 68, 24, 0.0)');
    edgeGrad.addColorStop(.5, 'rgba(235, 255, 210, 0.18)'); edgeGrad.addColorStop(.8, 'rgba(20, 68, 24, 0.0)');
    edgeGrad.addColorStop(1, 'rgba(20, 68, 24, 0.38)');
    ctx.fillStyle = edgeGrad; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(218, 247, 166, 0.85)'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(w * .5, h * .98); ctx.lineTo(w * .5, h * .08); ctx.stroke();
    ctx.strokeStyle = 'rgba(218, 247, 166, 0.52)'; ctx.lineWidth = 4;
    for (const vh of [.74, .52, .30]) {
      const y0 = vh * h, y1 = (vh - .16) * h;
      ctx.beginPath(); ctx.moveTo(w * .5, y0); ctx.quadraticCurveTo(w * .33, (y0 + y1) * .5, w * .18, y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w * .5, y0); ctx.quadraticCurveTo(w * .67, (y0 + y1) * .5, w * .82, y1); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 16; tex.needsUpdate = true; return tex;
  }
  function createPumpkinBodyGeometry() {
    const geom = new THREE.SphereGeometry(1, 96, 72), pos = geom.attributes.position, uv = geom.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const rXz = Math.sqrt(x * x + z * z), theta = Math.atan2(z, x);
      const grooveDepth = 1 - Math.pow(Math.abs(Math.cos(2 * theta)), .52);
      const radialScale = 1.27 * (1 - .30 * grooveDepth * Math.pow(rXz, .65));
      const belly = 1 - .065 * y + .04 * (1 - y * y);
      const crown = .065 * Math.sin(Math.min(1, rXz / .65) * Math.PI) * (1 - .45 * grooveDepth);
      pos.setXYZ(i, x * radialScale * belly, y * .86 + (y >= 0 ? crown : -crown) * rXz, z * radialScale * belly);
      uv.setXY(i, (theta + Math.PI) / (2 * Math.PI), THREE.MathUtils.clamp((1 - y) * .5, .001, .999));
    }
    geom.computeVertexNormals(); return geom;
  }
  function createStarStemMountGeometry(isTop = true) {
    const points = 5, outerR = isTop ? .165 : .145, innerR = isTop ? .072 : .062, shape = new THREE.Shape();
    for (let i = 0; i < points * 2; i++) {
      const angle = (i * Math.PI) / points, r = (i % 2 === 0) ? outerR : innerR;
      const px = Math.cos(angle) * r, py = Math.sin(angle) * r;
      if (i === 0) shape.moveTo(px, py); else shape.lineTo(px, py);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: isTop ? .032 : .018, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .010, bevelThickness: .010 });
    geo.rotateX(Math.PI / 2); geo.computeVertexNormals(); return geo;
  }
  function createCleanLeafWingGeometry(length, maxWidth, thickness, side) {
    const geom = new THREE.SphereGeometry(1, 40, 32), pos = geom.attributes.position, uvs = geom.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), u = (y + 1) * .5;
      let chordScale;
      if (u < .14) chordScale = .065 * Math.pow(u, .35) + .085 * Math.pow(u / .14, 2);
      else { const b = (u - .14) / .86; chordScale = .15 * (1 - b) + Math.sin(Math.pow(b, .68) * Math.PI) * (1.02 - .14 * b); }
      const thickScale = Math.pow(u, .22) * (1 - .42 * u) * (1 + .45 * Math.exp(-x * x * 8) * (1 - .5 * u));
      const lift = (.65 * thickness * thickScale) + .12 * u + .055 * Math.sin(u * Math.PI * .82);
      pos.setXYZ(i, x * maxWidth * chordScale, -side * z * thickness * thickScale + lift, side * u * length);
      uvs.setXY(i, (x + 1) * .5, u);
    }
    geom.computeVertexNormals(); return geom;
  }

  const BODY_TOP_VERTEX = new THREE.Vector3(0, 1, 0), BASE_MAIN_SWEEP = .08;
  const wingPivots = [], wingRoots = [], eyeMeshes = [], highlightGroups = [];

  const bodyMaterial = new THREE.MeshStandardMaterial({ map: createPumpkinBodyTexture(1.15), roughness: .46, metalness: .02 });
  const bodyMesh = new THREE.Mesh(createPumpkinBodyGeometry(), bodyMaterial);
  bodyMesh.name = 'Pumpkin_Body_4Ribs'; bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
  deformGroup.add(bodyMesh);

  const stemTraceGroup = new THREE.Group(); stemTraceGroup.name = 'Pumpkin_Star_Traces'; deformGroup.add(stemTraceGroup);
  const starMountMat = new THREE.MeshStandardMaterial({ color: 0x3b7a36, roughness: .52, metalness: .02 });
  const topStar = new THREE.Mesh(createStarStemMountGeometry(true), starMountMat);
  topStar.name = 'Pumpkin_Top_Star_Trace'; topStar.position.set(0, .895, 0); topStar.castShadow = true; stemTraceGroup.add(topStar);
  const stemNub = new THREE.Mesh(new THREE.CylinderGeometry(.036, .068, .115, 24), starMountMat);
  stemNub.name = 'Pumpkin_Top_Stem_Nub'; stemNub.position.set(0, .942, 0); stemNub.castShadow = true; stemTraceGroup.add(stemNub);
  const stemCapGeom = new THREE.SphereGeometry(.036, 20, 16); stemCapGeom.scale(1, .45, 1);
  const stemCap = new THREE.Mesh(stemCapGeom, starMountMat);
  stemCap.name = 'Pumpkin_Top_Vertex_Cap'; stemCap.position.set(0, .984, 0); stemTraceGroup.add(stemCap);
  const botStar = new THREE.Mesh(createStarStemMountGeometry(false), starMountMat);
  botStar.name = 'Pumpkin_Bottom_Star_Trace'; botStar.position.set(0, -.875, 0); botStar.rotation.x = Math.PI; stemTraceGroup.add(botStar);

  const eyeNormalMat = new THREE.MeshPhysicalMaterial({ color: 0x12090d, roughness: .08, metalness: .04, clearcoat: 1, clearcoatRoughness: .05 });
  const eyeBlackoutMat = new THREE.MeshStandardMaterial({ color: 0x020202, roughness: .98, metalness: 0 });
  const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  function createEyeUnit(isNearSide) {
    const eyeGroup = new THREE.Group();
    const sphereGeom = new THREE.SphereGeometry(.145, 32, 32); sphereGeom.scale(.62, 1.25, .90);
    const eyeMesh = new THREE.Mesh(sphereGeom, eyeNormalMat);
    eyeMesh.name = isNearSide ? 'Pumpkin_Eye_Left' : 'Pumpkin_Eye_Right'; eyeMesh.castShadow = true;
    eyeGroup.add(eyeMesh);
    const catchGroup = new THREE.Group();
    const hlMainGeom = new THREE.SphereGeometry(.036, 16, 16); hlMainGeom.scale(.65, 1, .85);
    const hlMain = new THREE.Mesh(hlMainGeom, highlightMat);
    hlMain.position.set(-.082, .065, isNearSide ? .042 : -.035); catchGroup.add(hlMain);
    const hlSub = new THREE.Mesh(new THREE.SphereGeometry(.016, 12, 12), highlightMat);
    hlSub.position.set(-.078, -.052, isNearSide ? .048 : -.042); catchGroup.add(hlSub);
    eyeGroup.add(catchGroup);
    return { eyeGroup, eyeMesh, catchGroup };
  }
  const leftEye = createEyeUnit(true); leftEye.eyeGroup.position.set(-1.19, .06, .27); leftEye.eyeGroup.rotation.y = -.22; deformGroup.add(leftEye.eyeGroup);
  const rightEye = createEyeUnit(false); rightEye.eyeGroup.position.set(-1.19, .06, -.27); rightEye.eyeGroup.rotation.y = .22; deformGroup.add(rightEye.eyeGroup);
  eyeMeshes.push({ eye: leftEye.eyeGroup, globe: leftEye.eyeMesh }, { eye: rightEye.eyeGroup, globe: rightEye.eyeMesh });
  highlightGroups.push(leftEye.catchGroup, rightEye.catchGroup);

  const wingMaterial = new THREE.MeshPhysicalMaterial({ map: createLeafWingTexture(1.15), color: 0xffffff, roughness: .28, metalness: 0, transparent: true, opacity: .98, clearcoat: .45, clearcoatRoughness: .20 });
  for (const side of [1, -1]) {
    const rootWing = new THREE.Group(), pivot = new THREE.Group();
    rootWing.position.copy(BODY_TOP_VERTEX);
    const baseSweep = -side * BASE_MAIN_SWEEP;
    rootWing.rotation.y = baseSweep;
    const mesh = new THREE.Mesh(createCleanLeafWingGeometry(1.18, .34, .085, side), wingMaterial);
    mesh.name = side > 0 ? 'Pumpkin_LeafWing_Left' : 'Pumpkin_LeafWing_Right';
    mesh.castShadow = true; pivot.add(mesh); rootWing.add(pivot); deformGroup.add(rootWing);
    wingPivots.push({ pivot, rootWing, side, baseSweep });
    wingRoots.push(rootWing);
  }

  const dizzyStarsGroup = new THREE.Group(); dizzyStarsGroup.position.set(-.25, 1.42, 0); dizzyStarsGroup.visible = false; deformGroup.add(dizzyStarsGroup);
  const starMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  for (let i = 0; i < 4; i++) { const ang = (i / 4) * Math.PI * 2, star = new THREE.Mesh(new THREE.OctahedronGeometry(.09, 0), starMat); star.position.set(Math.cos(ang) * .45, 0, Math.sin(ang) * .45); dizzyStarsGroup.add(star); }

  const ringMat = new THREE.MeshBasicMaterial({ color: 0x18181b, side: THREE.DoubleSide, transparent: true, opacity: 0 });
  const impactRing = new THREE.Mesh(new THREE.RingGeometry(.16, .25, 36), ringMat);
  impactRing.position.set(-1.35, .08, 0); impactRing.rotation.y = Math.PI / 2; deformGroup.add(impactRing);

  const state = {
    wingMode: 'idle', wingAngleDeg: 34, wingScale: 1, flapSpeedMult: 1, jiggleStrength: 1, colorDepth: 1.15,
    blackEyeActive: false, blackEyeLocked: false, blackEyeTimer: 0,
    velX: 0, velY: 0, dispX: 0, dispY: 0, squashPhase: 0, squashAmp: 0, ringTimer: 0,
    crashPhase: 'none', crashTimer: 0, spiralX: 0, spiralY: 0, spiralZ: 0, spiralYaw: 0, spiralRoll: 0, spiralPitch: 0,
    evadeDir: null, evadeTimer: 0, evadeDuration: .65, evadePos: new THREE.Vector3(), evadeRoll: 0, evadeYaw: 0, evadePitch: 0,
    wingSteerLeftAmp: 1, wingSteerRightAmp: 1, wingSteerSweepOffset: 0, wingSteerPitchOffset: 0,
  };

  function applyEyeAppearance(isBlackout) {
    const mat = isBlackout ? eyeBlackoutMat : eyeNormalMat;
    for (const { eye, globe } of eyeMeshes) { globe.material = mat; eye.scale.setScalar(isBlackout ? 1.07 : 1); }
    for (const g of highlightGroups) g.visible = !isBlackout;
  }
  function setWingScale(mult) {
    state.wingScale = THREE.MathUtils.clamp(Number(mult) || 1, .5, 2);
    for (const r of wingRoots) { r.scale.setScalar(state.wingScale); r.position.copy(BODY_TOP_VERTEX); }
    return state.wingScale;
  }
  function setColorDepth(mult) {
    state.colorDepth = Math.max(.8, Math.min(1.5, Number(mult) || 1.15));
    if (bodyMaterial.map) bodyMaterial.map.dispose();
    bodyMaterial.map = createPumpkinBodyTexture(state.colorDepth); bodyMaterial.needsUpdate = true;
    if (wingMaterial.map) wingMaterial.map.dispose();
    wingMaterial.map = createLeafWingTexture(state.colorDepth); wingMaterial.needsUpdate = true;
  }
  function setSubWingsVisible(visible) { stemTraceGroup.visible = Boolean(visible); }
  function setWingPose(mode = 'idle', angleDeg = 34) {
    state.wingMode = mode;
    if (Number.isFinite(Number(angleDeg))) state.wingAngleDeg = Math.max(6, Number(angleDeg));
  }
  function setFlapSpeed(mult) { state.flapSpeedMult = Math.max(0, Math.min(2.5, Number(mult) ?? 1)); }
  function setBlackEyeLock(locked) {
    state.blackEyeLocked = Boolean(locked);
    state.blackEyeActive = state.blackEyeLocked;
    applyEyeAppearance(state.blackEyeActive);
  }
  function triggerBlackEyeImpact(duration = 2) {
    state.blackEyeActive = true; state.blackEyeTimer = Math.max(.55, Number(duration) || 2); applyEyeAppearance(true);
    const mult = state.jiggleStrength;
    state.velX = 2.5 * mult; state.velY = .8 * mult;
    state.squashAmp = .14 * mult; state.squashPhase = 0; state.ringTimer = .85;
  }
  function triggerObstacleCrash() {
    state.evadeDir = null; state.evadeTimer = 0;
    state.crashPhase = 'falling'; state.crashTimer = 0;
    state.blackEyeActive = true; applyEyeAppearance(true);
    dizzyStarsGroup.visible = true;
    state.velX = 2.4; state.velY = .75;
    state.squashAmp = .16; state.squashPhase = 0; state.ringTimer = .9;
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
      const p = Math.min(1, state.crashTimer / 1.85);
      const turns = p * Math.PI * 2 * 2.5, spiralRadius = .28 * Math.sin(p * Math.PI);
      state.spiralX = Math.cos(turns) * spiralRadius; state.spiralZ = Math.sin(turns) * spiralRadius;
      state.spiralY = p < .82 ? -.88 * Math.pow(p / .82, 1.4) : -.88 + Math.sin(((p - .82) / .18) * Math.PI) * .14;
      state.spiralYaw = turns; state.spiralPitch = .22 * Math.sin(p * Math.PI); state.spiralRoll = .18 * Math.cos(turns * .5);
      dizzyStarsGroup.rotation.y = elapsed * 8.5; dizzyStarsGroup.rotation.z = Math.sin(elapsed * 6.5) * .12;
      if (p >= 1) { state.crashPhase = 'recover'; state.crashTimer = 0; }
    } else if (state.crashPhase === 'recover') {
      state.crashTimer += dt;
      const r = Math.min(1, state.crashTimer / .55), ease = 1 - Math.pow(1 - r, 3);
      state.spiralX = THREE.MathUtils.lerp(state.spiralX, 0, ease);
      state.spiralY = THREE.MathUtils.lerp(-.88, 0, ease);
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
      if (state.evadeDir === 'left') { state.evadePos.set(0, .10 * bell, 1.05 * bell); state.evadeRoll = -.48 * snap; state.evadeYaw = -.38 * snap; state.evadePitch = -.08 * snap; state.wingSteerLeftAmp = .72; state.wingSteerRightAmp = 1.32; state.wingSteerSweepOffset = .18 * snap; }
      else if (state.evadeDir === 'right') { state.evadePos.set(0, .10 * bell, -1.05 * bell); state.evadeRoll = .48 * snap; state.evadeYaw = .38 * snap; state.evadePitch = -.08 * snap; state.wingSteerLeftAmp = 1.32; state.wingSteerRightAmp = .72; state.wingSteerSweepOffset = -.18 * snap; }
      else if (state.evadeDir === 'up') { state.evadePos.set(-.14 * bell, .82 * bell, 0); state.evadeRoll = 0; state.evadeYaw = 0; state.evadePitch = -.42 * snap; state.wingSteerLeftAmp = 1.28; state.wingSteerRightAmp = 1.28; state.wingSteerPitchOffset = .22 * snap; }
      else if (state.evadeDir === 'down') { state.evadePos.set(-.14 * bell, -.78 * bell, 0); state.evadeRoll = 0; state.evadeYaw = 0; state.evadePitch = .42 * snap; state.wingSteerLeftAmp = .78; state.wingSteerRightAmp = .78; state.wingSteerPitchOffset = -.22 * snap; }
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
      const freq = (isPanic ? 24 : (isEvading ? 18 : (isFlying ? 20 : 11.5))) * state.flapSpeedMult;
      const wave = Math.sin(elapsed * freq), amp = isPanic ? 12 : 14;
      const lDeg = Math.max(8, 34 + wave * amp * state.wingSteerLeftAmp);
      const rDeg = Math.max(8, 34 + wave * amp * state.wingSteerRightAmp);
      for (const w of wingPivots) {
        const deg = w.side > 0 ? lDeg : rDeg;
        w.pivot.rotation.x = -w.side * THREE.MathUtils.degToRad(deg);
        w.pivot.rotation.z = (state.evadeRoll + flyX) * .25;
        w.rootWing.rotation.y = w.baseSweep + state.wingSteerSweepOffset - w.side * state.wingSteerPitchOffset;
      }
    } else {
      const rad = THREE.MathUtils.degToRad(Math.max(6, state.wingAngleDeg));
      for (const w of wingPivots) {
        w.pivot.rotation.x = -w.side * rad;
        w.pivot.rotation.z = 0;
        w.rootWing.rotation.y = w.baseSweep;
      }
    }

    const hoverY = state.wingMode === 'idle' && state.crashPhase === 'none' ? Math.sin(elapsed * 3) * .08 : Math.sin(elapsed * 1.6) * .03;
    const hoverPitch = state.wingMode === 'idle' && state.crashPhase === 'none' ? Math.cos(elapsed * 3) * .03 : 0;
    state.velX += (-140 * state.dispX - 12 * state.velX) * dt;
    state.velY += (-140 * state.dispY - 12 * state.velY) * dt;
    state.dispX += state.velX * dt; state.dispY += state.velY * dt;
    const stunJitterX = state.blackEyeActive && state.squashAmp > .03 ? Math.sin(elapsed * 60) * .022 * state.squashAmp : 0;
    animGroup.position.set(
      state.dispX + stunJitterX + state.evadePos.x + state.spiralX,
      hoverY + state.dispY + state.evadePos.y + state.spiralY,
      state.evadePos.z + state.spiralZ
    );
    animGroup.rotation.set(
      state.evadeRoll + state.spiralRoll + flyX,
      state.evadeYaw + state.spiralYaw,
      hoverPitch - state.dispX * .28 + state.evadePitch + state.spiralPitch + flyZ
    );

    if (state.squashAmp > .001) {
      state.squashPhase += dt * 24; state.squashAmp *= Math.pow(.08, dt);
      const s = Math.sin(state.squashPhase) * state.squashAmp;
      deformGroup.scale.set(1 - s * .75, 1 + s * .55, 1 + s * .55);
    } else deformGroup.scale.set(1, 1, 1);

    if (state.ringTimer > 0) {
      state.ringTimer = Math.max(0, state.ringTimer - dt * 2.5);
      const sc = 1 + (1 - state.ringTimer) * 3.2;
      impactRing.scale.set(sc, sc, 1);
      ringMat.opacity = state.ringTimer * .42;
    } else ringMat.opacity = 0;
  }

  model.rotation.y = -Math.PI / 2; model.scale.setScalar(.00333); root.add(model);
  if (opts.wingScale) setWingScale(opts.wingScale);
  root.userData = {
    bodyMaterial, wingMaterial, wingPivots, state, studioState: state,
    setWingScale, setColorDepth, setSubWingsVisible, setWingPose, setFlapSpeed,
    setBlackEyeLock, triggerBlackEyeImpact, triggerObstacleCrash, evade, updateStudio,
    designSource: 'user-supplied hand-built pumpkin geometry (3d_pumpkin studio)'
  };
  return root;
}

export const createHandDrawnPumpkin = createPumpkin;
