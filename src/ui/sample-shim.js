// NSP 3D — sample-shim.js
// Exposes our ESM modules as the window globals the sample studio pages
// (path-planner.html, maze-editor.html) expect, so their inline logic runs
// verbatim: THREE (r160 module), REFERENCE_MAZE_LAYOUTS (reference format),
// createCameraVisionDecoder, and the linear->sRGB flip helper.
import * as THREE from 'three';
import { REFERENCE_MAZE_LAYOUTS } from '../sim/maze-layouts.js';
import { createCameraVisionDecoder } from '../vision/camera-vision.js';
import { flipAndEncodeSrgb } from '../sim/sim-core.js';

export function setupSampleGlobals() {
  window.THREE = THREE;
  window.REFERENCE_MAZE_LAYOUTS = JSON.parse(JSON.stringify(REFERENCE_MAZE_LAYOUTS));
  window.createCameraVisionDecoder = createCameraVisionDecoder;
  window.__nspFlipSrgb = flipAndEncodeSrgb;
}
