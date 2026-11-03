// NSP 3D — camera-vision.js (ESM port of reference/camera-vision.js)
// Faithful port: 1-pass fog-attenuated pixel classifier + monocular/binocular decoders.
// Decoder build stamp: bump on every decoder change; the experiment page records
// it so a stale cached module can never silently invalidate an experiment.
export const DECODER_BUILD = '2026-11-01+sensor234-geoveto2-flr2-fu13';
// Any math change here must be justified against the user source, which takes precedence.
// Lateral 8-sector split (s0 far-left .. s7 far-right): freest-sector idea after FOAM (#39),
// unilateral-max gradient after LORA III (#41) — clean-room, no copied code. Existing
// thirds/grid/threat math is unchanged; sectors are additive signal fields.
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
// Escape-side Schmitt band (shared by both decoders): near-zero lateral
// asymmetry keeps the previous side instead of chattering each vision frame.
// Scale-matched to the rule symmetric epsilon (.02) — same noise floor.
const ESCAPE_BAND = 0.03;

// Shared 1-Pass GPU fog-attenuated pixel classifier (wall / colored obstacle / neon-lime goal beacon)
// Interior walls and the outer chamber liner (0x1678ff) share the exact same
// high-contrast depth-attenuated blue spectrum so outer walls and interior obstacles produce identical threat levels!
export function classifyPixel(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const darkBackdrop = max < 42;
  const goalBeacon = !darkBackdrop && g > 205 && g - r > 105 && g - b > 105;
  // Graded gray floor/ceiling (0x646464 + fog): neutral (max-min<30) and mid-bright.
  // Neutrality separates it from blue walls (b-dominant), red hazards, lime goal and
  // cyan edges across the whole fog track; the 104 ceiling excludes brighter-than-gray
  // neutrals (real gray renders <=101); disjointness is pinned in tests/run.mjs.
  const floorSlab = !darkBackdrop && !goalBeacon && max - min < 30 && max >= 45 && max <= 104;
  // Unified wall detector: bright blue walls (0x1678ff), interior and liner alike.
  const blueWall = !darkBackdrop && !goalBeacon && !floorSlab && ((b > 62 && b - g > 18 && b - r > 38) || (b > 48 && b - r > 28 && b >= g + 12));
  const colorObstacle = !darkBackdrop && !goalBeacon && !floorSlab && !blueWall && max > 68 && max - min > 42;
  const obstacle = blueWall || colorObstacle || floorSlab;
  const proximity = floorSlab ? clamp((max - 58) / 58, .20, 1) : blueWall ? clamp((b - 52) / 62, .16, 1) : colorObstacle ? clamp((max - 58) / 58, .20, 1) : 0;
  const visualDepth = floorSlab ? clamp((max - 42) / 213, .15, 1) : blueWall ? clamp((b - 40) / 215, .14, 1) : colorObstacle ? clamp((max - 42) / 213, .15, 1) : goalBeacon ? 1 : 0;
  return { goalBeacon, blueWall, colorObstacle, floorSlab, obstacle, proximity, visualDepth };
}

// Multi-Modal Sensor Pixel Evaluator (supports 'fog_rgb', 'z_depth', 'optical_flow', 'sensor_fusion')
// Guarantees high obstacle recognition across all 4 sensor modes!
export function evaluateSensorPixel(px, idx, x, y, width, height, rgba, depthRgba, sensorType, prevLumaBuf, flowEmaBuf, seamX = -1) {
  if (px.goalBeacon) {
    if (prevLumaBuf) prevLumaBuf[idx] = NaN;
    return { obstacle: false, proximity: 0, visualDepth: 1, isWall: false, isHazard: false, isFloorSlab: false };
  }
  if (!sensorType || sensorType === 'fog_rgb') {
    return { obstacle: px.obstacle, proximity: px.proximity, visualDepth: px.visualDepth, isWall: px.blueWall || px.floorSlab, isHazard: px.colorObstacle, isFloorSlab: px.floorSlab };
  }
  const i = idx * 4, r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
  const luma = (r * .299 + g * .587 + b * .114) / 255;

  // 1) Pure Geometric Hardware Z-Depth proximity:
  // When rendered by linearDepthMaterial (B channel depthRgba[i+2] > 0), uses G channel
  // geometric surface orientation (vHorizSurface > 180 => floor/ceiling slab) and gamma-decoded
  // (2.4) distance curve without ANY RGB color dependency; geometric veto gates far range.
  // Falls back to legacy per-class mapping only for synthetic unit-test buffers where G=0 & B=0.
  let depthProx = 0, depthVis = 0, depthFloor = px.floorSlab, hasShaderGeom = false;
  if (depthRgba && depthRgba.length >= rgba.length) {
    const linD = depthRgba[i] / 255; // 1.0 at 1.5cm .. 0.0 at 34cm (fog range)
    hasShaderGeom = depthRgba[i + 2] > 0 || depthRgba[i + 1] > 0;
    if (linD > .035) {
      if (hasShaderGeom) {
        depthFloor = depthRgba[i + 1] > 180;
        const dPercept = Math.pow(linD, 2.4); // gamma decode: restores near-range gradient (encode saturated the active band)
        depthProx = depthFloor
          ? clamp((80 * linD - 38) / 58, .20, 1)
          : clamp((235 * dPercept - 32) / 62, .16, 1);
        depthVis = clamp(dPercept * 1.15, .16, 1);
        if (linD < .32 && !depthFloor) { depthProx = 0; depthVis = 0; } // geometric veto (RGB-free): far walls stay silent
      } else {
        depthProx = px.floorSlab
          ? clamp((80 * linD - 38) / 58, .20, 1)
          : px.colorObstacle
            ? clamp((233 * linD - 52) / 58, .20, 1)
            : clamp((235 * linD - 32) / 62, .16, 1);
        depthVis = clamp(linD * 1.15, .16, 1);
        if (linD < .32 && !px.obstacle) { depthProx = 0; depthVis = 0; }
      }
    }
  } else if (px.obstacle) {
    depthProx = px.proximity; depthVis = px.visualDepth;
  }

  // 2) Spatio-Temporal Optical Flow (Drosophila T4/T5 Hassenstein-Reichardt EMD + Looming):
  // NaN-guarded first frame prevents reset spikes; Hassenstein-Reichardt cross-correlation
  // with right/down neighbors cancels static edges to zero and extracts true motion parallax.
  let flowProx = 0, flowVis = 0, motionActive = false;
  if (sensorType === 'optical_flow' || sensorType === 'sensor_fusion') {
    const hasPrev = prevLumaBuf && !Number.isNaN(prevLumaBuf[idx]);
    const prevL = hasPrev ? prevLumaBuf[idx] : luma;
    const tempDiff = hasPrev ? Math.abs(luma - prevL) : 0;
    const idxR = (x + 1 < width && x + 1 !== seamX) ? (idx + 1) : idx; // seamX: bino L/R boundary, no cross-eye correlation
    const idxD = (y + 1 < height) ? (idx + width) : idx;
    const iRight = idxR * 4, iDown = idxD * 4;
    const lumaRight = (rgba[iRight] * .299 + rgba[iRight + 1] * .587 + rgba[iRight + 2] * .114) / 255;
    const lumaDown = (rgba[iDown] * .299 + rgba[iDown + 1] * .587 + rgba[iDown + 2] * .114) / 255;
    const prevR = (prevLumaBuf && !Number.isNaN(prevLumaBuf[idxR])) ? prevLumaBuf[idxR] : lumaRight;
    const prevD = (prevLumaBuf && !Number.isNaN(prevLumaBuf[idxD])) ? prevLumaBuf[idxD] : lumaDown;
    if (prevLumaBuf) prevLumaBuf[idx] = luma;
    // Hassenstein-Reichardt delay-and-correlate elementary motion detector (zero on static edges)
    const hrX = hasPrev ? Math.abs(prevL * lumaRight - luma * prevR) : 0;
    const hrY = hasPrev ? Math.abs(prevL * lumaDown - luma * prevD) : 0;
    const iLeft = (x > 0 && x !== seamX) ? (idx - 1) * 4 : i, iUp = y > 0 ? (idx - width) * 4 : i;
    const lumaLeft = (rgba[iLeft] * .299 + rgba[iLeft + 1] * .587 + rgba[iLeft + 2] * .114) / 255;
    const lumaUp = (rgba[iUp] * .299 + rgba[iUp + 1] * .587 + rgba[iUp + 2] * .114) / 255;
    const spatialGrad = Math.min(1, (Math.abs(luma - lumaLeft) + Math.abs(luma - lumaUp)) * 3.2);
    const hrMotion = Math.min(1, (hrX + hrY) * 8.5 + tempDiff * 3.0);
    motionActive = hrMotion > .008;
    const rawFlow = Math.min(1, hrMotion + spatialGrad * (motionActive ? .45 : .25) + (px.obstacle ? px.proximity * .72 : 0));
    const smoothed = flowEmaBuf ? (flowEmaBuf[idx] = flowEmaBuf[idx] * .72 + rawFlow * .28) : rawFlow;
    if (smoothed > .05 || px.obstacle) {
      flowProx = clamp(px.obstacle ? Math.max(smoothed, px.proximity) : smoothed, .16, 1);
      flowVis = clamp(flowProx, .15, 1);
    }
  }

  if (sensorType === 'z_depth') {
    const isObs = depthProx > .05;
    const noColorInfo = !px.obstacle && !px.goalBeacon; // dark/bright-neutral: no floor/wall color signature
    return { obstacle: isObs, proximity: isObs ? depthProx : 0, visualDepth: isObs ? depthVis : 0, isWall: isObs && !px.colorObstacle, isHazard: isObs && px.colorObstacle, isFloorSlab: isObs ? (px.floorSlab || (noColorInfo && depthFloor)) : false }; // color-first, depth fallback when dark
  }
  if (sensorType === 'optical_flow') {
    const isObs = flowProx > .05;
    return { obstacle: isObs, proximity: isObs ? flowProx : 0, visualDepth: isObs ? flowVis : 0, isWall: isObs && !px.colorObstacle, isHazard: isObs && px.colorObstacle, isFloorSlab: px.floorSlab };
  }
  // 'sensor_fusion': Fog-RGB + Hassenstein-Reichardt Flow only (fu13: depth removed —
  // m16 showed the .55 depth weight dragging fusion below fog alone in 8/12 cells).
  // Weights keep the flr2 fog:flow ratio (35:10), renormalized; floor stays color-based.
  let fusedProx;
  if (hasShaderGeom) {
    fusedProx = clamp((px.obstacle ? px.proximity : 0) * .7778 + flowProx * .2222, 0, 1);
  } else {
    fusedProx = clamp(Math.max(flowProx, px.proximity), 0, 1);
  }
  const isObs = fusedProx > .05;
  const fusedFloor = px.floorSlab; // color-based: depthFloor (G>180) misroutes walls laterally (BA fusion-only review)
  return { obstacle: isObs, proximity: isObs ? fusedProx : 0, visualDepth: isObs ? clamp(Math.max(flowVis, px.visualDepth), .16, 1) : 0, isWall: isObs && !px.colorObstacle, isHazard: isObs && px.colorObstacle, isFloorSlab: isObs ? fusedFloor : false };
}

// ============================================================================
// [MODULE 1] MONOCULAR VISION DECODER (100° Single-Viewport Pipeline)
// Standalone monocular decoder — can be extracted to `camera-vision-mono.js`
// ============================================================================
// Frontal expansion (looming-rate) tracker: per-pixel temporal-difference EMA over the
// decoder's frontal zone only. Pure RATE signal (no static occupancy): rises while the
// frontal scene expands on approach, decays to zero when still. Feeds climb drives —
// never a direct climb command (cue bypass stays forbidden). After LGMD looming
// (CITATIONS #42); gain/EMA mirror the established flow pattern. Self-framing via
// scan-order index wrap, so no per-frame hook is needed at call sites.
export const createExpansionTracker = () => {
  let prev = null, ema = null, sum = 0, count = 0, lastIdx = -1;
  const init = n => { prev = new Float32Array(n).fill(NaN); ema = new Float32Array(n); sum = 0; count = 0; lastIdx = -1; };
  return {
    push(idx, luma, n) {
      if (!prev || prev.length !== n) init(n);
      if (idx <= lastIdx) { sum = 0; count = 0; } // scan-order wrap marks a new frame
      lastIdx = idx;
      const td = Number.isNaN(prev[idx]) ? 0 : Math.min(1, Math.abs(luma - prev[idx]) * 4.2);
      prev[idx] = luma;
      ema[idx] = ema[idx] * .72 + td * .28;
      sum += ema[idx]; count++;
    },
    value() { return count ? sum / count : 0; },
    reset() { if (prev) { prev.fill(NaN); ema.fill(0); } sum = 0; count = 0; lastIdx = -1; },
  };
};
export const createMonocularVisionDecoder = () => {
  let previous = { left: 0, front: 0, right: 0, up: 0, down: 0 };
  let lastEscape = 0;
  let prevLumaBuf = null, flowEmaBuf = null;
  const expansion = createExpansionTracker();
  function decode(rgba, width, height, options = {}) {
    const sensorType = typeof options === 'string' ? options : (options?.sensorType || 'fog_rgb');
    const depthRgba = options?.depthPixels || null;
    const nPix = width * height;
    if (!prevLumaBuf || prevLumaBuf.length !== nPix) { prevLumaBuf = new Float32Array(nPix).fill(NaN); flowEmaBuf = new Float32Array(nPix); }
    // 8x4 angular-even core (2a): columns split azimuth evenly (pinhole atan), rows split
    // world elevation evenly (+/-50 vfov). Zones/sectors/3x3 below are pixel-weighted
    // views over these cells (single source of truth). Floor class accumulates in
    // parallel wall-only sums so lateral views skip the pedestal while vertical
    // views and the grid keep positional truth.
    const tanV = Math.tan(50 * Math.PI / 180), tanH = tanV * width / height;
    const azHalf = Math.atan(tanH), azStep = 2 * azHalf / 8, elStep = (100 * Math.PI / 180) / 4;
    const cellCounts = new Float64Array(32), cellTotals = new Float64Array(32);
    const cellWallCounts = new Float64Array(32), cellWallTotals = new Float64Array(32);
    const pixelMask = new Uint8Array(nPix), depthMask = new Float32Array(nPix);
    let wallPixels = 0, colorPixels = 0, goalPixels = 0, goalXSum = 0, goalYSum = 0, detectedPixels = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const idx = y * width + x, i = idx * 4, rawPx = classifyPixel(rgba[i], rgba[i + 1], rgba[i + 2]);
      const ev = evaluateSensorPixel(rawPx, idx, x, y, width, height, rgba, depthRgba, sensorType, prevLumaBuf, flowEmaBuf);
      const isFloorSlab = (!sensorType || sensorType === 'fog_rgb') ? rawPx.floorSlab : (ev.isFloorSlab ?? rawPx.floorSlab);
      if (rawPx.goalBeacon) {
        pixelMask[idx] = 3; depthMask[idx] = 1; goalPixels++;
        goalXSum += (x / (width - 1)) * 2 - 1; goalYSum += 1 - (y / (height - 1)) * 2;
      }
      else if (ev.isWall) { pixelMask[idx] = 1; depthMask[idx] = ev.visualDepth; wallPixels++; }
      else if (ev.isHazard) { pixelMask[idx] = 2; depthMask[idx] = ev.visualDepth; colorPixels++; }
      const theta = Math.atan(((x + .5) / width * 2 - 1) * tanH);
      const phi = Math.atan((1 - (y + .5) / height * 2) * tanV);
      const col = Math.min(7, Math.max(0, Math.floor((theta + azHalf) / azStep)));
      const arow = Math.min(3, Math.max(0, Math.floor((phi + 50 * Math.PI / 180) / elStep)));
      const cellIdx = arow * 8 + col;
      cellTotals[cellIdx]++; if (ev.obstacle) { cellCounts[cellIdx] += ev.proximity; detectedPixels++; }
      if (!isFloorSlab || arow === 3) { cellWallTotals[cellIdx]++; if (ev.obstacle) cellWallCounts[cellIdx] += ev.proximity; } // K23: steep-up gray is ceiling/fog-wall, not floor
      if (col === 3 || col === 4) expansion.push(idx, (rgba[i] * .299 + rgba[i + 1] * .587 + rgba[i + 2] * .114) / 255, nPix);
    }
    const viewOcc = (cols, rows, wall) => {
      let c = 0, t = 0;
      for (const r of rows) for (const cc of cols) { const k = r * 8 + cc; c += wall ? cellWallCounts[k] : cellCounts[k]; t += wall ? cellWallTotals[k] : cellTotals[k]; }
      return t ? clamp(c / t) : 0;
    };
    const ALL_ROWS = [0, 1, 2, 3];
    // Row convention: arow 0 = image bottom (phi -50..-25deg), arow 3 = image top.
    const occupancy = {
      left: viewOcc([0, 1, 2], ALL_ROWS, true), front: viewOcc([3, 4], ALL_ROWS, true), right: viewOcc([5, 6, 7], ALL_ROWS, true),
      up: viewOcc([3, 4], [3], false), down: viewOcc([3, 4], [0], false),
      leftOuter: 0, leftInner: 0, rightInner: 0, rightOuter: 0,
    };
    occupancy.leftOuter = occupancy.left; occupancy.rightOuter = occupancy.right;
    occupancy.leftInner = occupancy.front; occupancy.rightInner = occupancy.front;
    const openness = {};
    for (const key of ['left', 'front', 'right', 'up', 'down', 'leftOuter', 'leftInner', 'rightInner', 'rightOuter']) {
      openness[key] = clamp(1 - occupancy[key]);
    }
    const gridCols = [[0, 1, 2], [3, 4], [5, 6, 7]], gridRows = [[3], [1, 2], [0]];
    const grid = [], gridWall = [];
    for (const gr of gridRows) for (const gc of gridCols) { grid.push(viewOcc(gc, gr, false)); gridWall.push(viewOcc(gc, gr, true)); }
    { const r1 = viewOcc([3, 4], [1], true), r2 = viewOcc([3, 4], [2], true); if (r1 > .60 && r2 > .60 && r2 >= r1 * .85 && gridWall[1] > .25) gridWall[1] = Math.max(gridWall[1], r2 * .85); }
    const clearanceGrid = grid.map(v => clamp(1 - v)), threat = {};
    // Threat curve relief (ii): x1.5 restores mid-range gradient (saturates occ>=.69, was .38).
    const sectors = Array.from({ length: 8 }, (_, i) => { const o = viewOcc([i], ALL_ROWS, true); return clamp(Math.max(0, o - .025) * 1.5); });
    // Corridor baseline subtraction (bino parity): symmetric side walls cancel
    // so corridors don't saturate L/R and collapse the steering differential.
    // Deadband stays .025 (mono), so asymmetric frames are bit-identical to before.
    const corridorClearScale = clamp(1 - occupancy.front * 1.6, .25, 1);
    const symmetricWallBaseline = Math.min(occupancy.left, occupancy.right) * .68 * corridorClearScale;
    const effLeftOcc = Math.max(0, occupancy.left - symmetricWallBaseline);
    const effRightOcc = Math.max(0, occupancy.right - symmetricWallBaseline);
    threat.left = clamp(Math.max(0, effLeftOcc - .025) * 1.5);
    threat.right = clamp(Math.max(0, effRightOcc - .025) * 1.5);
    for (const key of ['front', 'up', 'down']) threat[key] = clamp(Math.max(0, occupancy[key] - .025) * 1.5);
    const center = grid[4], upperRoute = grid[1], lowerRoute = grid[7];
    const openSpaceX = clamp(openness.right - openness.left, -1, 1), openSpaceY = clamp((1 - upperRoute) - (1 - lowerRoute), -1, 1);
    const goalVisible = goalPixels >= 2 ? clamp(goalPixels / Math.max(1, width * height * .00035)) : 0;
    const goalLockX = goalPixels >= 3 ? clamp(goalXSum / goalPixels, -1, 1) : 0;
    const goalLockY = goalPixels >= 3 ? clamp(goalYSum / goalPixels, -1, 1) : 0;
    const asymLR = occupancy.right - occupancy.left;
    // Frontal tie-break: a symmetric tie with a frontal wall (occ .36 ~= threat .5)
    // defaults right (+1, deadlock breaker); open ties hold straight (0) so the
    // vertical gate decides. Deterministic in frontal strength, never dust.
    const frontHigh = occupancy.front > .36;
    let escapeDirection;
    // K21: gate-forming ties (wall ahead + verified opening above/below +
    // blocked sides) hold straight — the premature deadlock veer yawed off-axis
    // before gate range. Full walls (no opening) keep the +1 default.
    const gateForming = gridWall[4] > .15 && (Math.min(Math.max(gridWall[3], gridWall[6]), Math.max(gridWall[5], gridWall[8])) > .3 || Math.min(gridWall[3], gridWall[5]) > .17) && (gridWall[1] < .35 || gridWall[7] < .35);
    if (lastEscape === 0) escapeDirection = asymLR > ESCAPE_BAND ? -1 : asymLR < -ESCAPE_BAND ? 1 : (frontHigh && !gateForming ? 1 : 0);
    else if (lastEscape > 0) escapeDirection = asymLR > ESCAPE_BAND ? -1 : 1;
    else escapeDirection = asymLR < -ESCAPE_BAND ? 1 : -1;
    lastEscape = escapeDirection;
    const cells = Array.from({ length: 32 }, (_, k) => cellTotals[k] ? clamp(cellCounts[k] / cellTotals[k]) : 0);
    const cellsWall = Array.from({ length: 32 }, (_, k) => cellWallTotals[k] ? clamp(cellWallCounts[k] / cellWallTotals[k]) : 0);
    const signal = {
      visionMode: 'monocular', sensorType,
      leftThreat: threat.left, rightThreat: threat.right, frontThreat: threat.front, upThreat: threat.up, downThreat: threat.down,
      leftOuterThreat: threat.left, leftInnerThreat: threat.front, rightInnerThreat: threat.front, rightOuterThreat: threat.right,
      leftEyeNasal: occupancy.front, rightEyeNasal: occupancy.front,
      binocularOverlap: occupancy.front, binocularDisparity: 0, stereoConvergence: occupancy.front,
      loomingL: clamp((occupancy.left - previous.left) * 14), loomingR: clamp((occupancy.right - previous.right) * 14),
      loomingC: expansion.value(),
      motionL: clamp(Math.abs(occupancy.left - previous.left) * 10), motionR: clamp(Math.abs(occupancy.right - previous.right) * 10),
      escapeDirection, openSpaceX, openSpaceY, occupancy, openness, coverage: occupancy, grid, gridWall, clearanceGrid, centerObstacle: center, upperRoute, lowerRoute, sectors, cells, cellsWall,
      detectedPixels, wallPixels, colorPixels, goalPixels, goalPixelsL: goalPixels, goalPixelsR: 0, goalVisible, goalLockX, goalLockY, pixelMask, depthMask
    };
    previous = occupancy; return signal;
  }
  return { decode, reset() { previous = { left: 0, front: 0, right: 0, up: 0, down: 0 }; lastEscape = 0; if (prevLumaBuf) prevLumaBuf.fill(NaN); if (flowEmaBuf) flowEmaBuf.fill(0); expansion.reset(); } };
};

// ============================================================================
// [MODULE 2] BINOCULAR COMPOUND-EYE DECODER (Left/Right ±28° Wide-FOV Split)
// Standalone binocular decoder — can be extracted to `camera-vision-bino.js`
// ============================================================================
export const createBinocularVisionDecoder = () => {
  let previous = { left: 0, front: 0, right: 0, up: 0, down: 0, leftOuter: 0, leftInner: 0, rightInner: 0, rightOuter: 0 };
  let lastEscape = 0;
  let prevLumaBuf = null, flowEmaBuf = null;
  const expansion = createExpansionTracker();
  const CANT_RAD = 0.488692; // ±28° compound-eye cant angle
  const FRONTAL_OVERLAP_RAD = 25 * Math.PI / 180; // ±25° frontal binocular half-field: conservative bound from #47 measurements; mirrors CAMERA_PIPELINE.binocularFrontalRad. Widens the Drosophila ±20.6° (#23) for this fruit-fly sim; the rayAngle mapping itself stays #23.
  const EYE_VFOV_RAD = 115 * Math.PI / 180;
  const EYE_ASPECT = 1.35;
  function decode(rgba, width, height, options = {}) {
    const sensorType = typeof options === 'string' && options !== 'binocular' ? options : (options?.sensorType || 'fog_rgb');
    const depthRgba = options?.depthPixels || null;
    const nPix = width * height;
    if (!prevLumaBuf || prevLumaBuf.length !== nPix) { prevLumaBuf = new Float32Array(nPix).fill(NaN); flowEmaBuf = new Float32Array(nPix); }
    const halfW = width >> 1;
    const tanHalfEyeHFov = Math.tan(EYE_VFOV_RAD * .5) * EYE_ASPECT;
    const monoTanHalfHFov = Math.tan(100 * Math.PI / 360) * (width / Math.max(1, height));
    // 8x4 foveated core (bino): frontal zone (+/-25 deg, #47) in 4 fine cols
    // (12.5 deg each, midline split) plus 2 coarse peripheral bands per side.
    // Finest discrimination sits at the fused object center, not the eye centers.
    // Rows split world elevation evenly over the 115-deg eye vfov. Zones/sectors/
    // 3x3 are pixel-weighted views (single source of truth). Floor routing matches
    // mono (lateral skips, vertical keeps).
    const RAY_MAX = CANT_RAD + Math.atan(tanHalfEyeHFov);
    const PERI_STEP = (RAY_MAX - FRONTAL_OVERLAP_RAD) / 2;
    const EL_HALF = EYE_VFOV_RAD * .5, EL_STEP = EYE_VFOV_RAD / 4;
    const cellCounts = new Float64Array(32), cellTotals = new Float64Array(32);
    const cellWallCounts = new Float64Array(32), cellWallTotals = new Float64Array(32);
    const cellBoostCounts = new Float64Array(32), cellBoostWallCounts = new Float64Array(32);
    const pixelMask = new Uint8Array(nPix), depthMask = new Float32Array(nPix);
    let wallPixels = 0, colorPixels = 0, goalPixels = 0, goalAngleSum = 0, goalYSum = 0, detectedPixels = 0;
    let goalPixelsL = 0, goalPixelsR = 0;
    let innerL = 0, innerLTot = 0, innerR = 0, innerRTot = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const idx = y * width + x, i = idx * 4, rawPx = classifyPixel(rgba[i], rgba[i + 1], rgba[i + 2]);
      const ev = evaluateSensorPixel(rawPx, idx, x, y, width, height, rgba, depthRgba, sensorType, prevLumaBuf, flowEmaBuf, halfW);
      const inLeftEye = x < halfW;
      const eyeLocalNorm = inLeftEye ? (x / Math.max(1, halfW - 1)) : ((x - halfW) / Math.max(1, width - halfW - 1));
      const eyeNdcX = eyeLocalNorm * 2 - 1; // [-1..+1] inside each eye
      const rayAngle = (inLeftEye ? -CANT_RAD : CANT_RAD) + Math.atan(eyeNdcX * tanHalfEyeHFov);
      // World ray angle mapping for binocular compound eyes (Kemppainen et al. 2022 PNAS; Fenk et al. 2022 Nature)
      // Frontal binocular overlap width: +/-25 deg (#47 bound), resolving contralateral crossover
      const isFrontalOverlap = Math.abs(rayAngle) <= FRONTAL_OVERLAP_RAD;
      const fa = Math.abs(rayAngle);
      let col;
      if (fa <= FRONTAL_OVERLAP_RAD / 2) col = rayAngle < 0 ? 3 : 4;
      else if (isFrontalOverlap) col = rayAngle < 0 ? 2 : 5;
      else { const k = Math.min(1, Math.floor((fa - FRONTAL_OVERLAP_RAD) / PERI_STEP)); col = rayAngle < 0 ? 1 - k : 6 + k; }
      const elev = Math.atan((1 - (y + .5) / height * 2) * Math.tan(EL_HALF));
      const arow = Math.min(3, Math.max(0, Math.floor((elev + EL_HALF) / EL_STEP)));
      const cellIdx = arow * 8 + col;
      const isFloorSlab = (!sensorType || sensorType === 'fog_rgb') ? rawPx.floorSlab : (ev.isFloorSlab ?? rawPx.floorSlab);

      if (rawPx.goalBeacon) {
        pixelMask[idx] = 3; depthMask[idx] = 1; goalPixels++;
        if (inLeftEye) goalPixelsL++; else goalPixelsR++;
        goalAngleSum += rayAngle;
        goalYSum += 1 - (y / (height - 1)) * 2;
      }
      else if (ev.isWall) { pixelMask[idx] = 1; depthMask[idx] = ev.visualDepth; wallPixels++; }
      else if (ev.isHazard) { pixelMask[idx] = 2; depthMask[idx] = ev.visualDepth; colorPixels++; }

      const isPeripheral = !isFrontalOverlap;
      // Hyperacute foveation boost on frontal binocular central rays
      const foveaBoost = isFrontalOverlap ? (1.0 + 0.42 * Math.max(0, 1 - Math.abs(rayAngle) / 0.32)) : 1.0;
      const baseProx = ev.obstacle ? ev.proximity * foveaBoost : 0;
      const zoneProximity = ev.obstacle ? (isPeripheral ? (ev.proximity * ev.proximity * (ev.proximity < .75 ? .45 : .95)) : baseProx) : 0;
      cellTotals[cellIdx]++; if (ev.obstacle) { cellCounts[cellIdx] += ev.proximity; detectedPixels++; }
      cellBoostCounts[cellIdx] += zoneProximity;
      if (!isFloorSlab || arow === 3) { // K23: steep-up gray is ceiling/fog-wall, not floor
        cellWallTotals[cellIdx]++;
        if (ev.obstacle) { const cScale = isFloorSlab ? .74 : 1; cellWallCounts[cellIdx] += ev.proximity * cScale; cellBoostWallCounts[cellIdx] += zoneProximity * cScale; }
      }
      if (isFrontalOverlap) expansion.push(idx, (rgba[i] * .299 + rgba[i + 1] * .587 + rgba[i + 2] * .114) / 255, nPix);
      if (isFrontalOverlap && !isFloorSlab) {
        if (rayAngle < 0) { innerLTot++; innerL += zoneProximity; }
        else { innerRTot++; innerR += zoneProximity; }
      }
    }
    const viewOcc = (cols, rows, mode) => {
      let c = 0, t = 0;
      for (const r of rows) for (const cc of cols) {
        const k = r * 8 + cc;
        if (mode === 'raw') { c += cellWallCounts[k]; t += cellWallTotals[k]; }
        else if (mode === 'wall') { c += cellBoostWallCounts[k]; t += cellWallTotals[k]; }
        else if (false) { c += cellWallCounts[k]; t += cellWallTotals[k]; } // V1.6: K25a wallRaw retired (kept line shape to minimize diff; never taken)
        // 'all' (U/D/grid only): RAW like sectors — fovea boost would saturate
        // the vertical channels (ceiling reads hot) and shut the climb gate.
        else { c += cellCounts[k]; t += cellTotals[k]; }
      }
      return t ? clamp(c / t) : 0;
    };
    const ALL_ROWS = [0, 1, 2, 3];
    const occupancy = {
      left: viewOcc([0, 1], ALL_ROWS, 'wall'), front: viewOcc([2, 3, 4, 5], ALL_ROWS, 'wall'), right: viewOcc([6, 7], ALL_ROWS, 'wall'),
      // Row convention: arow 0 = image bottom (elev -57.5..-28.75deg), arow 3 = image top.
      up: viewOcc([2, 3, 4, 5], [3], 'all'), down: viewOcc([2, 3, 4, 5], [0], 'all'),
      leftOuter: 0, leftInner: 0, rightInner: 0, rightOuter: 0,
    };
    occupancy.leftOuter = occupancy.left; occupancy.rightOuter = occupancy.right;
    occupancy.leftInner = innerLTot ? clamp(innerL / innerLTot) : 0;
    occupancy.rightInner = innerRTot ? clamp(innerR / innerRTot) : 0;
    const openness = {};
    for (const key of ['left', 'front', 'right', 'up', 'down', 'leftOuter', 'leftInner', 'rightInner', 'rightOuter']) {
      openness[key] = clamp(1 - occupancy[key]);
    }
    const gridCols = [[0, 1], [2, 3, 4, 5], [6, 7]], gridRows = [[3], [1, 2], [0]];
    const grid = [], gridWall = [];
    for (const gr of gridRows) for (const gc of gridCols) { grid.push(viewOcc(gc, gr, 'all')); const r1T = cellWallTotals[11] + cellWallTotals[12], r2T = cellWallTotals[19] + cellWallTotals[20]; const useInner = gr[0] === 0 && gc.length === 4 && cellWallCounts[3] === 0 && cellWallCounts[4] === 0 && r2T > 0 && r1T > 0 && (cellWallCounts[11] + cellWallCounts[12]) / r1T < (cellWallCounts[19] + cellWallCounts[20]) / r2T * .85; gridWall.push(viewOcc(useInner ? [3, 4] : gc, gr, 'raw')); }
    const clearanceGrid = grid.map(v => clamp(1 - v));
    const sectors = Array.from({ length: 8 }, (_, j) => { const o = viewOcc([j], ALL_ROWS, 'raw'); return clamp(Math.max(0, o - .025) * 1.5); });

    // Optic-Flow Corridor Baseline Subtraction
    const corridorClearScale = clamp(1 - occupancy.front * 1.6, .25, 1);
    const symmetricWallBaseline = Math.min(occupancy.left, occupancy.right) * .68 * corridorClearScale;
    const effLeftOcc = Math.max(0, occupancy.left - symmetricWallBaseline);
    const effRightOcc = Math.max(0, occupancy.right - symmetricWallBaseline);
    const threat = {
      left: clamp(Math.max(0, effLeftOcc - .018) * 1.5),
      right: clamp(Math.max(0, effRightOcc - .018) * 1.5),
      front: clamp(Math.max(0, occupancy.front - .025) * 1.5),
      up: clamp(Math.max(0, occupancy.up - .025) * 1.5),
      down: clamp(Math.max(0, occupancy.down - .025) * 1.5)
    };

    const center = grid[4], upperRoute = grid[1], lowerRoute = grid[7];
    const openSpaceX = clamp(openness.right - openness.left, -1, 1), openSpaceY = clamp((1 - upperRoute) - (1 - lowerRoute), -1, 1);
    const goalVisible = goalPixels >= 2 ? clamp(goalPixels / Math.max(1, width * height * .00030)) : 0;
    let goalLockX = 0, binocularGoalBearing = 0;
    if (goalPixels >= 2) {
      binocularGoalBearing = goalAngleSum / goalPixels;
      goalLockX = clamp(Math.tan(binocularGoalBearing) / monoTanHalfHFov, -1, 1);
    }
    const goalLockY = goalPixels >= 2 ? clamp(goalYSum / goalPixels, -1, 1) : 0;
    const leftEyeNasal = occupancy.leftInner, rightEyeNasal = occupancy.rightInner;
    const binocularOverlap = clamp((leftEyeNasal + rightEyeNasal) * .5);
    const binocularDisparity = clamp((leftEyeNasal - rightEyeNasal) * 2.4, -1, 1);
    const stereoConvergence = clamp(Math.sqrt(leftEyeNasal * rightEyeNasal) * 2.8);
    const totalAsymmetry = (occupancy.right + rightEyeNasal * .6) - (occupancy.left + leftEyeNasal * .6);
    let escapeDirection;
    // Frontal tie-break (mono mirror): symmetric tie with a frontal wall
    // defaults right (+1, deadlock breaker); open ties hold straight (0).
    const frontHigh = occupancy.front > .36;
    // K21: gate-forming ties hold straight (mono mirror) — see above.
    const gateForming = gridWall[4] > .15 && (Math.min(Math.max(gridWall[3], gridWall[6]), Math.max(gridWall[5], gridWall[8])) > .3 || Math.min(gridWall[3], gridWall[5]) > .17) && (gridWall[1] < .35 || gridWall[7] < .35);
    if (lastEscape === 0) escapeDirection = totalAsymmetry > ESCAPE_BAND ? -1 : totalAsymmetry < -ESCAPE_BAND ? 1 : (frontHigh && !gateForming ? 1 : 0);
    else if (lastEscape > 0) escapeDirection = totalAsymmetry > ESCAPE_BAND ? -1 : 1;
    else escapeDirection = totalAsymmetry < -ESCAPE_BAND ? 1 : -1;
    lastEscape = escapeDirection;
    const cells = Array.from({ length: 32 }, (_, k) => cellTotals[k] ? clamp(cellCounts[k] / cellTotals[k]) : 0);
    const cellsWall = Array.from({ length: 32 }, (_, k) => cellWallTotals[k] ? clamp(cellWallCounts[k] / cellWallTotals[k]) : 0);
    const signal = {
      visionMode: 'binocular', sensorType,
      leftThreat: threat.left, rightThreat: threat.right, frontThreat: threat.front, upThreat: threat.up, downThreat: threat.down,
      leftOuterThreat: clamp(Math.max(0, occupancy.leftOuter - symmetricWallBaseline - .018) * 1.5),
      leftInnerThreat: clamp(Math.max(0, leftEyeNasal - .020) * 1.5),
      rightInnerThreat: clamp(Math.max(0, rightEyeNasal - .020) * 1.5),
      rightOuterThreat: clamp(Math.max(0, occupancy.rightOuter - symmetricWallBaseline - .018) * 1.5),
      leftEyeNasal, rightEyeNasal,
      binocularOverlap, binocularDisparity, stereoConvergence, binocularGoalBearing,
      loomingL: clamp((occupancy.left - previous.left) * 14), loomingR: clamp((occupancy.right - previous.right) * 14),
      loomingC: expansion.value(),
      motionL: clamp(Math.abs(occupancy.left - previous.left) * 10), motionR: clamp(Math.abs(occupancy.right - previous.right) * 10),
      escapeDirection, openSpaceX, openSpaceY, occupancy, openness, coverage: occupancy, grid, gridWall, clearanceGrid, centerObstacle: center, upperRoute, lowerRoute, sectors, cells, cellsWall,
      detectedPixels, wallPixels, colorPixels, goalPixels, goalPixelsL, goalPixelsR, goalVisible, goalLockX, goalLockY, pixelMask, depthMask
    };
    previous = { ...occupancy }; return signal;
  }
  return { decode, reset() { previous = { left: 0, front: 0, right: 0, up: 0, down: 0, leftOuter: 0, leftInner: 0, rightInner: 0, rightOuter: 0 }; lastEscape = 0; if (prevLumaBuf) prevLumaBuf.fill(NaN); if (flowEmaBuf) flowEmaBuf.fill(0); expansion.reset(); } };
};

// VFH valley-seek over the wall-only 8x4 cells (Borenstein & Koren 1991 idea,
// clean-room reimplementation on the decoder's angular grid — no copied code).
// Flight-band clearance per azimuth column (rows 1-2 = +/-25deg elevation),
// contiguous free runs wider than VALLEY_MIN_COLS, goal-biased pick: nearest
// the desired heading (goal bearing when visible, straight ahead otherwise).
// Returns { found, centerErr (-1..+1, + = valley center right of heading),
// widthCols }. Pure and total: shared by the rule and SNN controllers so both
// transit the same valley (parity). Bino columns are foveally warped, so
// centerErr is approximately (not exactly) linear in azimuth there.
const VALLEY_FREE_OCC = .3, VALLEY_MIN_COLS = 2;
export function computeValleySteer(cellsWall, goalBias = 0) {
  if (!Array.isArray(cellsWall) || cellsWall.length !== 32) return { found: false, centerErr: 0, widthCols: 0 };
  const desired = 3.5 + Math.max(-1, Math.min(1, Number(goalBias) || 0)) * 3.5;
  const centerBand = Math.max(Number(cellsWall[11]) || 0, Number(cellsWall[19]) || 0, Number(cellsWall[12]) || 0, Number(cellsWall[20]) || 0);
  const isFree = (occ) => occ < VALLEY_FREE_OCC || occ < centerBand * .5; // K16-B: relative opening — fog-dim side walls count when much clearer than a blocked center
  let best = null;
  for (let s = 0; s < 8;) {
    const occ = Math.max(Number(cellsWall[8 + s]) || 0, Number(cellsWall[16 + s]) || 0);
    if (!isFree(occ)) { s++; continue; }
    let e = s;
    while (e + 1 < 8) {
      const next = Math.max(Number(cellsWall[8 + e + 1]) || 0, Number(cellsWall[16 + e + 1]) || 0);
      if (!isFree(next)) break;
      e++;
    }
    const width = e - s + 1, center = (s + e) / 2, score = Math.abs(center - desired);
    if (width >= VALLEY_MIN_COLS && (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && (width > best.width || (width === best.width && center > best.center))))) {
      best = { score, width, center };
    }
    s = e + 1;
  }
  if (!best) return { found: false, centerErr: 0, widthCols: 0 };
  return { found: true, centerErr: (best.center - 3.5) / 3.5, widthCols: best.width };
}

// Unified facade that routes to the separated Monocular or Binocular decoder module
export const createCameraVisionDecoder = () => {
  const monoDecoder = createMonocularVisionDecoder();
  const binoDecoder = createBinocularVisionDecoder();
  return {
    decode(rgba, width, height, mode = 'monocular', options = {}) {
      return mode === 'binocular' ? binoDecoder.decode(rgba, width, height, options) : monoDecoder.decode(rgba, width, height, options);
    },
    decodeMonocular: monoDecoder.decode,
    decodeBinocular: binoDecoder.decode,
    reset() { monoDecoder.reset(); binoDecoder.reset(); }
  };
};
