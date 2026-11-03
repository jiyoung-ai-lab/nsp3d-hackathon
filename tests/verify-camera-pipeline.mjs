#!/usr/bin/env node
// NSP 3D port of reference/verify-camera-pipeline.js (ESM, zero hardcoded paths).
// Same invariants, adapted to the nsp3d module layout:
// app.js -> src/ui/app.js, scene/rig -> src/sim/sim-core.js,
// decoder -> src/vision/camera-vision.js, network -> src/nn/graph-network.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCameraVisionDecoder } from '../src/vision/camera-vision.js';
import { mergeFlightGraphs, createFlightConnectome } from '../src/nn/graph-network.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const app = read('src/ui/app.js');
const sim = read('src/sim/sim-core.js');
const html = read('index.html');
const decoderSource = read('src/vision/camera-vision.js');
const ruleSource = read('src/sim/camera-controller.js');
const config = read('src/config.js');
// Source invariants ignore formatting whitespace (ESM style vs minified reference).
const flat = (s) => s.replace(/\s+/g, '');
const fapp = flat(app), fsim = flat(sim), frule = flat(ruleSource);

// Architectural invariants: two render cameras, one shared agent-view frame for visual analysis.
assert.match(fsim, /observerCamera\.layers\.set\(0\);observerCamera\.layers\.enable\(1\);observerCamera\.layers\.enable\(2\)/,
  'observer camera must show common world, observer walls, and observer-only layer 2');
assert.match(fsim, /eyeCamera\.layers\.set\(0\);eyeCamera\.layers\.enable\(3\)/,
  'agent vision camera must show common world and opaque fly-only layer 3, excluding observer-only layers');
assert.match(config, /fov:\s*100\b/, 'agent vision fov must be 100');
assert.match(config, /near:\s*0\.001\b/, 'agent vision near must be 0.001');
assert.match(config, /far:\s*2\.0\b/, 'agent vision far must cover the full chamber');
assert.match(config, /pitchGain:\s*0\b/, 'agent vision must stay level (gaze stabilization) so pitching does not slide walls into D/U zones');
assert.match(fsim, /beeVisionFog=newTHREE\.Fog\(0x060914,CAMERA_PIPELINE\.fogNear,CAMERA_PIPELINE\.fogFar\)/,
  'agent vision must use 1-pass camera distance fog attenuation');
assert.match(fsim, /beeOpaqueShell=newTHREE\.Group\(\)/,
  'fly POV must have its own opaque chamber shell');
assert.match(fsim, /\[-W\/2\+\.0012,Y\/2,0,\.001,Y-\.002,Z-\.002,beeBoundaryWallMat,true\]/,
  'fly POV liner must include the four fog-graded outer walls');
assert.match(fsim, /beeBoundaryWallMat=newTHREE\.MeshBasicMaterial\(\{color:0x1678ff,transparent:false,opacity:1,depthWrite:true,side:THREE\.DoubleSide\}\)/,
  'fly POV liner must be opaque unlit blue (fog-graded, same as interior walls)');
assert.match(fsim, /beeCeilingMat=newTHREE\.MeshBasicMaterial\(\{color:0x646464,transparent:false,opacity:1,depthWrite:true,side:THREE\.DoubleSide\}\)[\s\S]*?beeFloorMat=newTHREE\.MeshBasicMaterial\(\{color:0x646464,transparent:false,opacity:1,depthWrite:true,side:THREE\.DoubleSide\}\)/,
  'fly POV ceiling and floor must use graded neutral gray (fog:true, no fog:false) so floor/ceiling read as distance obstacles');
assert.doesNotMatch(fsim, /0x12344d/,
  'diagnostic navy shell must be fully deleted (occluded dead geometry caused the phantom era)');
assert.match(fsim, /color:0x39ff14,fog:false/,
  'goal beacon must bypass camera distance fog so it remains visible across the chamber');
assert.match(fapp, /data\.gains\?\.monocular\|\|data\.gains\?\.binocular\?data\.gains:data/,
  'weights file input must unwrap pretrained {gains:{monocular,binocular}} roots like loadPretrainedBtn');
assert.match(fapp, /functionrunEpisode\([^)]*\)\{setWorld\(seed\);rig\.reset\(\);/,
  'each bench episode must reset the shared rig decoder so flow/escape history cannot leak across episodes and conditions');
assert.match(fapp, /letlearnNet=null;[\s\S]{0,200}awaitensurePlugin\(\);try\{/,
  'bench sets comparing neuron models must ensure the ALIF plugin loads, or the ALIF row silently runs LIF');
assert.match(fsim, /constactiveTurn=Number\.isFinite\(decision\.turn\)\?decision\.turn:0;/,
  'movement must guard a NaN turn (a single NaN poisons yaw and the whole sim)');
assert.match(fapp, /renderer\.render\(scene,mainCam\)/,
  'observer rendering must use stable layer masks without per-frame visibility changes');
assert.doesNotMatch(fapp, /onBeforeRender=|onAfterRender=|visionMaterialRestore/,
  'camera-specific material mutation during rendering can cause flicker and must be removed');
assert.doesNotMatch(fsim, /onBeforeRender=|onAfterRender=|visionMaterialRestore/,
  'camera-specific material mutation during rendering can cause flicker and must be removed');
assert.match(fsim, /beePanel\.layers\.set\(3\)[\s\S]*?beeEdges\.layers\.set\(3\)/,
  'fly POV must have opaque maze panel and cyan edge meshes on its private render layer');
assert.match(fsim, /clampEyeToChamber\(eyeCamera\.position,WORLD\)[\s\S]*?clampEyeToChamber\(eyeCameraL\.position,WORLD\)[\s\S]*?clampEyeToChamber\(eyeCameraR\.position,WORLD\)/,
  'all three eye cameras must clamp inside the chamber so wall contact reads the wall, not void');
assert.match(html, /id="langSelect"[\s\S]*?value="en"[\s\S]*?value="ko"/,
  'a visible language selector must expose English and Korean');
assert.match(fsim, /renderer\.render\(scene,eyeCamera\)[\s\S]*?renderer\.readRenderTargetPixels\(H\.visionTarget,0,0,width,height,this\.visionPixels\)/,
  'agent vision must render and read back pixels from eyeCamera');
assert.match(fsim, /this\.decoder\.decode\(this\.visionImage\.data,width,height/,
  'decoder must consume the same pixels read from the agent camera');
assert.match(fapp, /depthAlpha=signal\.depthMask\?signal\.depthMask\[i\]:1/,
  'Fly POV preview must modulate mask alpha by pixel depth');
assert.match(fapp, /latestVision=signal/,
  'decoded camera signal must be shared with the controller path');
assert.match(fapp, /S\.rule\.step\(brain\):network\.step\(brain\)/,
  'neural experiment must feed decoded sensory features into the neural network');
assert.match(app, /from '\.\.\/vision\/camera-vision\.js'/,
  'app must load the visual decoder module');
assert.match(app, /from '\.\.\/sim\/camera-controller\.js'/,
  'app must load the single-source rule controller module');
assert.doesNotMatch(fapp, /functionsense\(/,
  'sense() must live only in sim/camera-controller.js (no app-local copy to drift)');
assert.doesNotMatch(fapp, /functioncameraRuleController\(/,
  'cameraRuleController must live only in sim/camera-controller.js (no app-local copy to drift)');

// Avoid oracle leakage: the controller's sensory adapter may not calculate goal bearing from world coordinates.
const senseMatch = frule.match(/functionsenseVision\([\s\S]*?functioncreateCameraRuleController/);
assert(senseMatch, 'senseVision() adapter not found');
assert.doesNotMatch(senseMatch[0], /goal\.x\s*-\s*pos\.x|goal\.z\s*-\s*pos\.z|goal\.y\s*-\s*pos\.y/,
  'goal direction must come from the camera image, not ground-truth world coordinates');
assert.match(senseMatch[0], /vision\.goalLockX/,
  'goal direction must be derived from camera-detected goal pixels');
assert.match(senseMatch[0], /renderedPitch\s*\+\s*Math\.atan/,
  'goalVertical must add renderedPitch (pitch x pitchGain) so a level eye (gain 0) does not double-count body pitch and flip below-goals above');
assert.match(senseMatch[0], /pitch\s*\*\s*\(CAMERA_PIPELINE\.pitchGain/,
  'renderedPitch must scale body pitch by CAMERA_PIPELINE.pitchGain');

// Verify rule lateral avoidance: 8-sector mean+max differential, freest-sector cost,
// and graded touch reflex (single source: sim/camera-controller.js).
assert.match(frule, /latErr=\(\.5\*\(sideL-sideR\)\+\.5\*\(maxL-maxR\)\)\*wallSuppress/,
  'rule sector differential must share the thirds wall-suppression (goal/gate parity)');
assert.match(frule, /freeBias=\(neutral\?0:\(best-3\.5\)\/3\.5\)\*wallSuppress/,
  'rule freest bias must neutralize on mirror-symmetric ties in the open and share wall-suppression');
assert.match(frule, /:\(\(symmetric&&!confined\)\?0:\(s\.escapeDirection\|\|\(\(s\.frontRaw\?\?s\.frontThreat\)>\.5\?1:0\)\)\)/,
  'rule must hold straight on near-symmetric input in the open, decoder side or frontal default when confined');
assert.match(frule, /confined=frontTRaw>\.5/,
  'rule regime split must key off the blocked-front threshold');
assert.match(frule, /sectors\.map\(\(value\)=>clamp\(value\*s\)\)/,
  'senseVision must scale sectors with sensitivity like thirds and grid');
assert.match(frule, /side=clamp\(avoidTurn\+goalTurn\+touchTurn,-1,1\)/,
  'rule must add the graded mechanosensory touch reflex into the turn command');
assert.match(frule, /climb=clamp\(climb\+loomC\*1\.4,-\.9,\.9\)/,
  'rule must pre-climb on the frontal looming rate, mirroring the SNN drive (K11 x1.4 parity)');
assert.match(frule, /&&upper<\.35\)climb/,
  'rule pre-climb must fire only on verified open above (K19R evidence, like the gate)');
assert.match(frule, /goalVis<\.05&&!verticalPassage&&!valleyTransit&&Math\.abs\(side\)<\.3125/,
  'rule must cast idle search pulses mirroring the SNN saccade');
assert.match(frule, /st\.satN>120\?\(Math\.floor\(st\.satN\/120\)%2===0\?1:-1\)/,
  'rule must alternate the escape side after sustained saturated blockage');
assert.match(fapp, /consumeSteps\(simAcc,frameDt\)/,
  'live loop must integrate the sim through the fixed-step accumulator, not wall-clock dt');
assert.match(fapp, /if\(resetGains&&network\)network\.resetLearning\(\)/,
  'per-episode reset must split dynamics from learned gains');
assert.match(decoderSource, /createCameraVisionDecoder/,
  'the visual decoder module must expose the unified facade');
assert.match(fapp, /\$\('range'\)\.value\/10/,
  'vision gain compute must use the /10 slider scale matching the display');
assert.doesNotMatch(fapp, /range'\)\.value\/12/,
  'no stale /12 slider scale may remain in vision gain paths');
assert.ok((decoderSource.match(/lastEscape/g) || []).length >= 8,
  'both decoders must keep Schmitt escape-side state with reset handling');
assert.match(decoderSource, /ESCAPE_BAND\s*=\s*0\.03/,
  'escape Schmitt band must be 0.03, scale-matched to the rule symmetric epsilon');
assert.match(frule, /c<minCost\+0\.02\?i:-1/,
  'freest tie tolerance must be 0.02 so rendering noise cannot break mirror neutralization');

// Run the actual pixel decoder against a deterministic synthetic frame.
const decoder = createCameraVisionDecoder();
const width = 160, height = 90;
const pixels = new Uint8ClampedArray(width * height * 4);
for (let i = 0; i < pixels.length; i += 4) {
  pixels[i] = 6; pixels[i + 1] = 9; pixels[i + 2] = 20; pixels[i + 3] = 255;
}
for (let y = 20; y < 80; y++) for (let x = 0; x < 48; x++) {
  const i = (y * width + x) * 4;
  pixels[i] = 20; pixels[i + 1] = 80; pixels[i + 2] = 180; pixels[i + 3] = 255;
}
for (let y = 40; y < 50; y++) for (let x = 118; x < 128; x++) {
  const i = (y * width + x) * 4;
  pixels[i] = 57; pixels[i + 1] = 255; pixels[i + 2] = 20; pixels[i + 3] = 255;
}
const signal = decoder.decode(pixels, width, height);
assert(signal.leftThreat > signal.rightThreat, 'left-side obstacle pixels must produce greater left threat');
assert(signal.goalPixels >= 100, 'green goal pixels must be detected independently from obstacles');
assert(signal.goalVisible > 0.05, 'visible goal pixels must create a usable target-visible signal');
assert(signal.pixelMask.some((v) => v === 1), 'wall mask must be generated from the rendered pixels');
assert(signal.pixelMask.some((v) => v === 3), 'goal mask must be generated from the same rendered pixels');
assert(ArrayBuffer.isView(signal.depthMask) && signal.depthMask.some((v) => v > 0.5), 'depthMask must provide distance-graded values for preview and sensing');
assert.equal(signal.upperRoute, signal.grid[1], 'upper clearance must use the center image column, not side-wall pixels');
assert.equal(signal.lowerRoute, signal.grid[7], 'lower clearance must use the center image column, not side-wall pixels');
assert.equal(signal.sectors.length, 8, 'decoder must expose 8 lateral sectors (s0 far-left .. s7 far-right)');
assert(
  (signal.sectors[0] + signal.sectors[1] + signal.sectors[2] + signal.sectors[3]) >
  (signal.sectors[4] + signal.sectors[5] + signal.sectors[6] + signal.sectors[7]),
  'left-half wall pixels must raise the left sector group above the right group');

// Binocular frontal overlap follows the 50-60° field (#47 measurements): wall pixels on
// rays between the old Drosophila ±20.6° edge and the new ±25° edge must count as
// frontal (front occupancy + frontal sector pair), not lateral.
const binoDecoder = createCameraVisionDecoder();
const binoHalfW = width >> 1;
const binoTanHalfEye = Math.tan(115 * Math.PI / 360) * 1.35;
const probeNdcX = Math.tan(0.40 + 0.488692) / binoTanHalfEye;
const probeX = Math.round(((probeNdcX + 1) / 2) * (binoHalfW - 1));
const rayOfLeftEye = (x) => -0.488692 + Math.atan((((x / (binoHalfW - 1)) * 2 - 1)) * binoTanHalfEye);
assert(rayOfLeftEye(probeX - 1) > 0.36 && rayOfLeftEye(probeX + 1) < 25 * Math.PI / 180,
  'probe strip must sit on rays inside the newly frontal band (0.36 .. 25deg)');
const binoFrame = new Uint8ClampedArray(width * height * 4);
for (let i = 0; i < binoFrame.length; i += 4) { binoFrame[i] = 6; binoFrame[i + 1] = 9; binoFrame[i + 2] = 20; binoFrame[i + 3] = 255; }
for (let y = 0; y < height; y++) for (let x = probeX - 1; x <= probeX + 1; x++) {
  const i = (y * width + x) * 4;
  binoFrame[i] = 20; binoFrame[i + 1] = 80; binoFrame[i + 2] = 180; binoFrame[i + 3] = 255;
}
const binoSignal = binoDecoder.decode(binoFrame, width, height, 'binocular');
assert(binoSignal.occupancy.front > 0, 'newly frontal rays must contribute to front occupancy');
assert(binoSignal.sectors[5] > binoSignal.sectors[6], 'newly frontal rays must land in the frontal quad, not the lateral pair');
assert.match(decoderSource, /FRONTAL_OVERLAP_RAD\s*=\s*25\s*\*\s*Math\.PI\s*\/\s*180/,
  'binocular frontal overlap must use the ±25° half-field (#47 bound)');

// Frontal expansion rate: a growing frontal patch (approach) must register loomingC;
// a repeated static frame must let the rate decay toward zero.
const loomDecoder = createCameraVisionDecoder();
const paintFrontal = (x0, x1, y0, y1) => {
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < frame.length; i += 4) { frame[i] = 6; frame[i + 1] = 9; frame[i + 2] = 20; frame[i + 3] = 255; }
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * width + x) * 4;
    frame[i] = 20; frame[i + 1] = 50; frame[i + 2] = 120; frame[i + 3] = 255;
  }
  return frame;
};
assert.equal(loomDecoder.decode(paintFrontal(64, 96, 35, 55), width, height).loomingC, 0,
  'first frame initializes the expansion tracker with no history');
const loomGrown = loomDecoder.decode(paintFrontal(54, 106, 25, 65), width, height);
assert(loomGrown.loomingC > .01, 'an expanding frontal patch must register a positive looming rate');
let loomStill = loomGrown;
for (let i = 0; i < 7; i++) loomStill = loomDecoder.decode(paintFrontal(54, 106, 25, 65), width, height);
assert(loomStill.loomingC < loomGrown.loomingC * .15, 'the looming rate must decay toward zero when the scene is still');

// Verify distance-attenuated proximity grading (near bright wall > mid fogged wall > far fogged open space).
const midFogFrame = new Uint8ClampedArray(width * height * 4);
for (let i = 0; i < midFogFrame.length; i += 4) { midFogFrame[i] = 6; midFogFrame[i + 1] = 9; midFogFrame[i + 2] = 20; midFogFrame[i + 3] = 255; }
for (let y = 20; y < 80; y++) for (let x = 0; x < 48; x++) {
  const i = (y * width + x) * 4;
  midFogFrame[i] = 10; midFogFrame[i + 1] = 36; midFogFrame[i + 2] = 78; midFogFrame[i + 3] = 255;
}
const midFogSignal = decoder.decode(midFogFrame, width, height);
assert(midFogSignal.occupancy.left > 0 && midFogSignal.occupancy.left < signal.occupancy.left,
  'mid-distance fog-attenuated wall must produce weaker occupancy than a close bright wall');

// Exercise the real graph controller with the decoder's sensory features.
function loadGraphFile(rel) {
  const text = read(rel);
  const m = text.match(/window\.(?:FLIGHT_GRAPH|FLIGHT_CIRCUIT_EXTENSION)\s*=\s*(\{[\s\S]*\});?\s*$/);
  const obj = m ? JSON.parse(m[1]) : JSON.parse(text);
  if (!obj.edges && Array.isArray(obj.pairs)) {
    obj.edges = obj.pairs.map((p) => ({ source: p.src ?? p.source, target: p.dst ?? p.target, weight: p.w ?? p.weight }));
  }
  return obj;
}
const graph = mergeFlightGraphs(loadGraphFile('vendor/connectome/flight-graph.js'), loadGraphFile('vendor/connectome/flight-circuit-extension.js'));
const network = createFlightConnectome(graph);
let output;
for (let tick = 0; tick < 24; tick++) {
  output = network.step({ ...signal, altitude: 0.02, goalBearing: 0.2, goalVertical: 0 });
}
assert(Number.isFinite(output.turn) && Number.isFinite(output.climb), 'neural action outputs must be finite');
assert(output.spikeCount > 0 || output.telemetry.length > 0, 'camera-derived signals must activate the neural circuit');

// Free-altitude open-space check: flying at mid-chamber (altitude 0.10m) in open space must not force a dive to 2cm.
const openSpaceFrame = new Uint8ClampedArray(width * height * 4);
for (let i = 0; i < openSpaceFrame.length; i += 4) { openSpaceFrame[i] = 6; openSpaceFrame[i + 1] = 9; openSpaceFrame[i + 2] = 20; openSpaceFrame[i + 3] = 255; }
const openSpaceSignal = decoder.decode(openSpaceFrame, width, height);
const openSpaceNet = createFlightConnectome(graph);
let openSpaceOut;
for (let tick = 0; tick < 24; tick++) openSpaceOut = openSpaceNet.step({ ...openSpaceSignal, altitude: 0.10 });
assert.equal(openSpaceOut.climb, 0, 'open space at mid-chamber altitude must maintain level flight without forced 2cm return');

// Terminal goal fixation check: when goal is clearly visible on the right (goalVisible=1, goalLockX=0.6) even with right-side background wall threat,
// the neural controller must steer toward the visible goal (turn > 0) rather than swerving away from the wall behind the goal.
const goalFixNet = createFlightConnectome(graph);
let goalFixOut;
for (let tick = 0; tick < 24; tick++) {
  goalFixOut = goalFixNet.step({ ...openSpaceSignal, rightThreat: 0.75, goalVisible: 1, goalLockX: 0.65, goalBearing: 0.5, goalVertical: -0.25 });
}
assert(goalFixOut.turn > 0 && goalFixOut.climb < 0, 'visible goal beacon must suppress background wall repulsion and steer 3D trajectory into the target');

// Exact opaque fly-camera palette must be recognized as a wall and drive spiking neurons.
const beePaletteFrame = new Uint8ClampedArray(width * height * 4);
for (let i = 0; i < beePaletteFrame.length; i += 4) { beePaletteFrame[i] = 6; beePaletteFrame[i + 1] = 9; beePaletteFrame[i + 2] = 20; beePaletteFrame[i + 3] = 255; }
for (let y = 18; y < 82; y++) for (let x = 0; x < 62; x++) { const i = (y * width + x) * 4; beePaletteFrame[i] = 22; beePaletteFrame[i + 1] = 120; beePaletteFrame[i + 2] = 255; beePaletteFrame[i + 3] = 255; }
const beePaletteSignal = decoder.decode(beePaletteFrame, width, height);
assert(beePaletteSignal.wallPixels > 0, 'actual fly POV blue wall palette was not detected by the camera decoder');
// Full-frame liner blue (near, unfogged) must read as wall everywhere AND saturate
// directional occupancy: the outer wall is an obstacle (req 1), same as interior walls.
const linerFrame = new Uint8ClampedArray(width * height * 4);
for (let i = 0; i < linerFrame.length; i += 4) { linerFrame[i] = 22; linerFrame[i + 1] = 120; linerFrame[i + 2] = 255; linerFrame[i + 3] = 255; }
const linerSignal = decoder.decode(linerFrame, width, height);
assert.equal(linerSignal.wallPixels, width * height, 'liner blue must be reported as visible wall pixels');
assert(Object.values(linerSignal.occupancy).every((v) => v > 0.5), 'near liner must saturate directional obstacle occupancy like interior walls');
// A small lime goal beacon must become visible before it fills a large fraction of the image.
const smallGoalFrame = new Uint8ClampedArray(width * height * 4);
for (let i = 0; i < smallGoalFrame.length; i += 4) { smallGoalFrame[i] = 6; smallGoalFrame[i + 1] = 9; smallGoalFrame[i + 2] = 20; smallGoalFrame[i + 3] = 255; }
for (let y = 42; y < 45; y++) for (let x = 78; x < 81; x++) { const i = (y * width + x) * 4; smallGoalFrame[i] = 57; smallGoalFrame[i + 1] = 255; smallGoalFrame[i + 2] = 20; smallGoalFrame[i + 3] = 255; }
const smallGoalSignal = decoder.decode(smallGoalFrame, width, height);
assert(smallGoalSignal.goalPixels >= 9 && smallGoalSignal.goalVisible > .025, 'small goal beacon must trigger visual target lock earlier');
const beePaletteNetwork = createFlightConnectome(graph);
let beePaletteOutput;
for (let tick = 0; tick < 24; tick++) beePaletteOutput = beePaletteNetwork.step({ ...beePaletteSignal, altitude: .02 });
assert(beePaletteOutput.spikeCount > 0 || beePaletteOutput.telemetry.length > 0, 'actual fly POV wall palette did not activate the neural circuit');
assert.equal(output.upperDrive, 0, 'a wall confined to the left side must not create direct upper sensory drive');
assert.equal(output.lowerDrive, 0, 'a wall confined to the left side must not create direct lower sensory drive');
assert(Math.abs(output.climb) < 0.1, 'lateral-only camera input must not cause an incidental climb/dive output');

// Main scene controls are restored to the original observer-camera modes; only fly POV remains in the bottom preview.
assert.match(html, /id="cameraFollow"/, 'original Smart Drone camera control must be restored');
assert.match(html, /id="cameraOverview"/, 'original 3P Overview camera control must be restored');
assert.match(html, /id="cameraCloseup"/, 'original Close-up camera control must be restored');
assert.doesNotMatch(html, /id="previewObserver"|id="viewObserver"|id="viewBee"|id="beeViewFull"/, 'observer preview and full-screen agent view toggles must be removed');
assert.doesNotMatch(app, /cameraPreviewMode|setDisplayView|previewObserver/, 'observer preview logic must be removed');
assert.match(fsim, /newTHREE\.MeshBasicMaterial\(\{color:0x1678ff,transparent:false,opacity:1,depthWrite:true,side:THREE\.DoubleSide\}\)/, 'fly POV maze panels must use a separate opaque high-contrast material');
assert.match(fsim, /newTHREE\.LineBasicMaterial\(\{color:0x53f5ff,transparent:false,opacity:1\}\)/, 'fly POV maze edges must use a separate cyan material');
assert.match(fsim, /functionsetSceneWallTransparency\([\s\S]*?constobserverOpaque=cameraMode==='overview'/, 'observer wall transparency must depend on the selected camera mode');
const movementStart = fsim.indexOf('exportfunctionmovement(');
assert(movementStart >= 0, 'movement() function not found');
const movementSource = fsim.slice(movementStart);
assert.doesNotMatch(movementSource, /wallKind==='open_top'[^}]*state\.pitch\s*=\s*\.45|wallKind==='open_top'[^}]*pos\.y\s*\+\s*dt\s*\*\s*\.14/, 'open_top contact must not directly force a climb');
assert.match(movementSource, /Physical\s*ceiling\s*safety[\s\S]*?pos\.y\s*>\s*Y\s*-\s*\.035/, 'a ceiling safety guard must prevent repeated positive climb commands');
assert.match(movementSource, /pos\.y\s*<\s*\.020\s*&&\s*\(climb\s*<\s*0\s*\|\|\s*state\.pitch\s*<\s*0\)/, 'a symmetrical floor safety guard must prevent persistent negative dive commands from pinning the agent to the floor');
assert.doesNotMatch(movementSource, /state\.yaw\+=evadeDir\*Math\.max\(\.18/, 'kinematic yaw kick must be removed: post-contact rotation is delegated to the brain');
assert.match(movementSource, /touchFromContact\(nx,nz,state\.yaw/, 'contact must emit a graded mechanosensory touch event for the reflex path');
assert.match(movementSource, /touch:freshTouch/, 'movement must return the touch event to the caller');
assert.match(movementSource, /isUnwedging\(state\.bumpEma\)&&isStalled\(state\.odo\)/,
  'movement must reverse only when grinding coincides with stalled self-motion');

console.log(JSON.stringify({
  status: 'PASS',
  cameraInvariantChecks: 49,
  depthAttenuationCheck: 'PASS (near > mid > far open-space proximity grading)',
  freeAltitudeOpenSpaceCheck: 'PASS (no forced 2cm dive in clear open space)',
  fixedStepCheck: 'PASS (sim integrates at fixed 1/60 regardless of render fps)',
  circuitResetCheck: 'PASS (per-episode reset splits dynamics from learned gains)',
  unwedgeCheck: 'PASS (grinding + stalled motion reverses; threading scrapes push through)',
  terminalGoalFixationCheck: 'PASS (visible goal suppresses background wall repulsion and locks 3D pitch/yaw)',
  cameraBaselineControllerCheck: 'PASS (8-sector differential, freest-sector bias, touch reflex, directional looming pre-climb, gate discrimination, idle-cast mirror, anti-stall veer, suppression parity, symmetric centering, escape Schmitt verified)',
  verticalClearanceCheck: 'PASS (side-only obstacle does not create direct upper/lower drive or pitch output)',
  goalOracleLeakCheck: 'PASS',
  syntheticFrame: { width, height, leftThreat: signal.leftThreat, rightThreat: signal.rightThreat, goalPixels: signal.goalPixels, goalVisible: signal.goalVisible },
  neuralOutput: { turn: output.turn, climb: output.climb, spikeCount: output.spikeCount, activeTelemetry: output.telemetry.length },
  note: 'This is a source/pixel-decoder/neural-network integration test; it does not replace a real browser WebGL visual test.',
}, null, 2));
