// NSP 3D — maze layouts (reference-format stages + editor-compatible objects).
// Canonical data: MAZES (object walls with y-range for fly-over / fly-under).
// REFERENCE_MAZE_LAYOUTS is derived for the sim (wall arrays [x,z,w,l,bottom,top,tag]).
// Chamber: X/Z in [-0.50, +0.50] m, Y in [0.0, 0.20] m.
import { STORE_KEYS } from '../config.js';

export const CHAMBER = { halfX: 0.5, halfZ: 0.5, height: 0.2 };
export const SEAL = { edgeSnap: 0.045, axialPad: 0.012, minThick: 0.016 };
const STORE_KEY = STORE_KEYS.customMazes;

// Deterministic PRNG (reference/app.js rng).
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reference-exact wall sealing on array-format walls [x,z,width,length,bottom,top,wallKind].
// Automatically seals 1~3cm exterior boundary gaps and corner micro-gaps.
export function sealMazeWalls(walls) {
  const H = CHAMBER.halfX;
  const boxes = (walls || []).map(([x, z, width, length, bottom, top, wallKind]) => ({
    minX: x - width / 2, maxX: x + width / 2, minZ: z - length / 2, maxZ: z + length / 2,
    bottom, top, wallKind, horiz: width >= length,
  }));
  for (const b of boxes) {
    if (b.minX > -H && b.minX <= -H + .065) b.minX = -H;
    if (b.maxX < H && b.maxX >= H - .065) b.maxX = H;
    if (b.minZ > -H && b.minZ <= -H + .065) b.minZ = -H;
    if (b.maxZ < H && b.maxZ >= H - .065) b.maxZ = H;
  }
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < boxes.length; i++) for (let j = 0; j < boxes.length; j++) {
    if (i === j) continue;
    const a = boxes[i], b = boxes[j];
    if (a.horiz) {
      if (Math.min(a.maxZ + .036, b.maxZ) - Math.max(a.minZ - .036, b.minZ) >= 0) {
        if (a.minX > b.minX && a.minX - b.maxX > -.005 && a.minX - b.maxX <= .036) a.minX = b.minX;
        if (a.maxX < b.maxX && b.minX - a.maxX > -.005 && b.minX - a.maxX <= .036) a.maxX = b.maxX;
      }
    } else {
      if (Math.min(a.maxX + .036, b.maxX) - Math.max(a.minX - .036, b.minX) >= 0) {
        if (a.minZ > b.minZ && a.minZ - b.maxZ > -.005 && a.minZ - b.maxZ <= .036) a.minZ = b.minZ;
        if (a.maxZ < b.maxZ && b.minZ - a.maxZ > -.005 && b.minZ - a.maxZ <= .036) a.maxZ = b.maxZ;
      }
    }
  }
  return boxes.map(b => [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, b.maxZ - b.minZ, b.bottom, b.top, b.wallKind]);
}

export function normalizeMazeWall(w) {
  const o = {
    x: +w.x || 0,
    z: +w.z || 0,
    w: Math.max(+w.w || 0, SEAL.minThick),
    d: Math.max(+w.d || 0, SEAL.minThick),
    y0: w.y0 == null ? 0 : Math.min(Math.max(+w.y0, 0), CHAMBER.height),
    y1: w.y1 == null ? CHAMBER.height : Math.min(Math.max(+w.y1, 0), CHAMBER.height),
  };
  if (o.y1 - o.y0 < 0.02) o.y1 = Math.min(CHAMBER.height, o.y0 + 0.02);
  o.x = Math.min(Math.max(o.x, -CHAMBER.halfX), CHAMBER.halfX);
  o.z = Math.min(Math.max(o.z, -CHAMBER.halfZ), CHAMBER.halfZ);
  return o;
}

export function normalizeObstacle(ob) {
  const kind = ob.kind === 'pillar' || ob.kind === 'balloon' ? ob.kind : 'ring';
  return {
    kind,
    x: Math.min(Math.max(+ob.x || 0, -0.46), 0.46),
    z: Math.min(Math.max(+ob.z || 0, -0.46), 0.46),
    r: Math.min(Math.max(+ob.r || 0.05, 0.008), 0.09),
    y: kind === 'balloon' ? Math.min(Math.max(+ob.y || 0.12, 0.05), 0.17) : 0,
  };
}

function wallTag(w) {
  if (w.y0 > 0.001) return 'open_bottom'; // passage below: fly under
  if (w.y1 < CHAMBER.height - 0.001) return 'open_top'; // passage above: fly over
  return undefined; // full-height wall
}

// yaw convention: forward F = (sin yaw, 0, -cos yaw).
export const MAZES = [
  {
    id: 'open_arena', name: 'Open', nameKo: '개방형', builtin: true,
    thickness: 0.020, hazardRange: [5, 7],
    walls: [
      { x: 0, z: -0.05, w: 0.3, d: 0.018, y0: 0.1, y1: 0.2 },
      { x: -0.25, z: 0.15, w: 0.018, d: 0.3 },
      { x: 0.25, z: 0.15, w: 0.018, d: 0.3 },
      { x: 0, z: 0.3, w: 0.4, d: 0.018, y0: 0, y1: 0.09 },
      { x: -0.3, z: -0.3, w: 0.3, d: 0.018 },
      { x: 0.3, z: -0.32, w: 0.018, d: 0.24 },
      { x: -0.05, z: 0.02, w: 0.018, d: 0.22, y0: 0.08, y1: 0.2 },
    ],
    start: { x: -0.35, z: 0.3, yaw: 0.87 },
    goal: { x: 0.35, z: -0.3 },
    hazards: [{ x: 0, z: 0.15, r: 0.06 }],
    obstacles: [
      { kind: 'pillar', x: -0.12, z: -0.28, r: 0.015 },
      { kind: 'pillar', x: 0.18, z: 0.22, r: 0.015 },
      { kind: 'balloon', x: 0.05, z: -0.05, r: 0.035, y: 0.13 },
      { kind: 'balloon', x: -0.25, z: 0.05, r: 0.03, y: 0.09 },
    ],
  },
  {
    id: 'corridor', name: 'Corridor', nameKo: '복도', builtin: true,
    thickness: 0.016, hazardRange: [5, 8],
    walls: [
      { x: -0.15, z: 0.12, w: 0.66, d: 0.018 },
      { x: 0.15, z: -0.14, w: 0.66, d: 0.018 },
      { x: -0.32, z: -0.3, w: 0.018, d: 0.24 },
      { x: 0.32, z: 0.3, w: 0.018, d: 0.24 },
      { x: 0, z: 0.36, w: 0.3, d: 0.018, y0: 0, y1: 0.1 },
      { x: 0, z: -0.36, w: 0.3, d: 0.018, y0: 0.1, y1: 0.2 },
      { x: -0.05, z: 0.0, w: 0.018, d: 0.2, y0: 0.1, y1: 0.2 },
    ],
    start: { x: -0.38, z: 0.36, yaw: 0.87 },
    goal: { x: 0.38, z: -0.36 },
    hazards: [{ x: 0.3, z: 0.28, r: 0.05 }],
    obstacles: [
      { kind: 'pillar', x: 0, z: -0.01, r: 0.014 },
      { kind: 'balloon', x: -0.2, z: -0.25, r: 0.032, y: 0.14 },
      { kind: 'balloon', x: 0.22, z: 0.24, r: 0.032, y: 0.08 },
    ],
  },
  {
    id: 's_maze', name: 'S-Shape', nameKo: 'S자', builtin: true,
    thickness: 0.012, hazardRange: [5, 7],
    walls: [
      { x: -0.12, z: 0.02, w: 0.018, d: 0.62 },
      { x: 0.14, z: -0.04, w: 0.018, d: 0.62 },
      { x: -0.3, z: 0.3, w: 0.3, d: 0.018 },
      { x: 0.3, z: -0.32, w: 0.3, d: 0.018 },
      { x: 0.01, z: 0.0, w: 0.2, d: 0.018, y0: 0.09, y1: 0.2 },
      { x: -0.3, z: -0.3, w: 0.24, d: 0.018, y0: 0, y1: 0.08 },
      { x: 0.3, z: 0.3, w: 0.24, d: 0.018 },
    ],
    start: { x: -0.38, z: -0.36, yaw: 2.33 },
    goal: { x: 0.38, z: 0.36 },
    hazards: [{ x: -0.32, z: 0.3, r: 0.05 }],
    obstacles: [
      { kind: 'pillar', x: -0.25, z: -0.05, r: 0.014 },
      { kind: 'pillar', x: 0.27, z: 0.08, r: 0.014 },
      { kind: 'balloon', x: 0.01, z: -0.2, r: 0.03, y: 0.12 },
    ],
  },
  {
    id: 'pillars', name: 'Pillars', nameKo: '기둥', builtin: true,
    thickness: 0.009, hazardRange: [6, 9],
    walls: [
      { x: -0.2, z: -0.2, w: 0.09, d: 0.09 },
      { x: 0.2, z: -0.2, w: 0.09, d: 0.09 },
      { x: -0.2, z: 0.2, w: 0.09, d: 0.09 },
      { x: 0.2, z: 0.2, w: 0.09, d: 0.09 },
      { x: 0, z: 0, w: 0.16, d: 0.018, y0: 0, y1: 0.09 },
      { x: 0, z: 0.35, w: 0.3, d: 0.018, y0: 0.1, y1: 0.2 },
      { x: 0, z: -0.35, w: 0.3, d: 0.018 },
    ],
    start: { x: -0.38, z: 0, yaw: Math.PI / 2 },
    goal: { x: 0.38, z: 0 },
    hazards: [{ x: 0, z: 0.25, r: 0.05 }, { x: 0, z: -0.25, r: 0.05 }],
    obstacles: [
      { kind: 'balloon', x: -0.1, z: 0.1, r: 0.032, y: 0.13 },
      { kind: 'balloon', x: 0.1, z: -0.1, r: 0.032, y: 0.1 },
      { kind: 'balloon', x: 0, z: 0, r: 0.03, y: 0.15 },
      { kind: 'pillar', x: -0.3, z: -0.3, r: 0.013 },
      { kind: 'pillar', x: 0.3, z: 0.3, r: 0.013 },
    ],
  },
  {
    id: 'complex', name: 'Complex', nameKo: '복합', builtin: true,
    thickness: 0.006, hazardRange: [6, 10],
    walls: [
      { x: -0.2, z: 0.15, w: 0.5, d: 0.018 },
      { x: 0.2, z: -0.1, w: 0.5, d: 0.018 },
      { x: 0.0, z: 0.28, w: 0.018, d: 0.3 },
      { x: -0.3, z: -0.28, w: 0.018, d: 0.3 },
      { x: 0.3, z: 0.28, w: 0.24, d: 0.018, y0: 0, y1: 0.08 },
      { x: -0.05, z: -0.38, w: 0.26, d: 0.018, y0: 0.1, y1: 0.2 },
      { x: 0.38, z: 0.05, w: 0.018, d: 0.2 },
    ],
    start: { x: -0.38, z: 0.38, yaw: 2.4 },
    goal: { x: 0.38, z: -0.38 },
    hazards: [{ x: 0.05, z: 0.02, r: 0.055 }, { x: -0.05, z: -0.32, r: 0.045 }],
    obstacles: [
      { kind: 'pillar', x: -0.1, z: 0.3, r: 0.014 },
      { kind: 'pillar', x: 0.12, z: -0.22, r: 0.014 },
      { kind: 'balloon', x: -0.22, z: -0.05, r: 0.03, y: 0.12 },
      { kind: 'balloon', x: 0.05, z: 0.32, r: 0.032, y: 0.09 },
    ],
  },
  // ---- Sample stages (reference/samplesource/assets/maze-layouts.js + maze-hazards.js) ----
  // Converted reference[x, z] -> maze {x, z:-z}; walls thinner than SEAL.minThick
  // are widened by normalizeMazeWall (noted deviation, A*-verified solvable).
  {
    id: 'multi_level_3d', name: 'Multi-Level', nameKo: '다층', builtin: true,
    thickness: 0.02, hazardRange: [5, 6],
    walls: [
      { x: -0.31, z: 0.10, w: 0.02, d: 0.36 },
      { x: 0.31, z: 0.10, w: 0.02, d: 0.36 },
      { x: 0, z: 0.20, w: 0.38, d: 0.02, y0: 0, y1: 0.052 },
      { x: 0, z: -0.02, w: 0.38, d: 0.02, y0: 0.072, y1: 0.2 },
      { x: -0.41, z: -0.16, w: 0.18, d: 0.02 },
      { x: 0.41, z: -0.16, w: 0.18, d: 0.02 },
      { x: 0, z: -0.24, w: 0.34, d: 0.02, y0: 0, y1: 0.055 },
    ],
    start: { x: 0, z: -0.4, yaw: 3.14 }, goal: { x: 0, z: 0.4 },
    hazardPool: [[-0.11, -0.31, 'x', 0.05, 1.0], [0.11, -0.31, 'x', 0.05, 0.9], [-0.14, -0.1, 'x', 0.05, 1.1], [0.14, -0.1, 'x', 0.05, 1.0], [0.0, -0.09, 'x', 0.06, 1.2], [-0.16, 0.1, 'z', 0.05, 1.0], [0.16, 0.1, 'z', 0.05, 1.0], [0.0, 0.11, 'x', 0.06, 1.1], [-0.12, 0.32, 'x', 0.05, 0.9], [0.12, 0.32, 'x', 0.05, 1.1]],
  },
  {
    id: 'zigzag_labyrinth', name: 'Zigzag', nameKo: '지그재그', builtin: true,
    thickness: 0.016, hazardRange: [5, 6],
    walls: [
      { x: -0.22, z: 0.22, w: 0.46, d: 0.016 },
      { x: 0.22, z: -0.02, w: 0.46, d: 0.016 },
      { x: -0.22, z: -0.24, w: 0.46, d: 0.016 },
      { x: 0.28, z: 0.22, w: 0.24, d: 0.016, y0: 0, y1: 0.052 },
      { x: -0.28, z: -0.02, w: 0.24, d: 0.016, y0: 0.072, y1: 0.2 },
      { x: 0.28, z: -0.24, w: 0.24, d: 0.016, y0: 0, y1: 0.055 },
      { x: 0, z: 0.36, w: 0.22, d: 0.016, y0: 0, y1: 0.052 },
    ],
    start: { x: -0.35, z: -0.41, yaw: 2.44 }, goal: { x: 0.35, z: 0.41 },
    hazardPool: [[-0.15, -0.35, 'z', 0.04, 1.0], [0.12, -0.35, 'x', 0.05, 1.1], [0.34, -0.22, 'z', 0.05, 1.0], [0.12, -0.12, 'z', 0.04, 1.2], [-0.12, -0.12, 'z', 0.04, 0.9], [-0.34, 0.0, 'z', 0.05, 1.1], [-0.12, 0.12, 'z', 0.04, 1.0], [0.12, 0.12, 'z', 0.04, 1.1], [0.34, 0.22, 'z', 0.05, 0.9], [0.05, 0.35, 'x', 0.05, 1.0], [-0.18, 0.35, 'x', 0.05, 1.1]],
  },
  {
    id: 'grid_matrix', name: 'Grid', nameKo: '격자', builtin: true,
    thickness: 0.012, hazardRange: [5, 6],
    walls: [
      { x: -0.26, z: 0.20, w: 0.012, d: 0.34 },
      { x: 0, z: 0.04, w: 0.012, d: 0.32 },
      { x: 0.26, z: -0.20, w: 0.012, d: 0.34 },
      { x: -0.40, z: -0.16, w: 0.20, d: 0.012 },
      { x: 0.40, z: 0.16, w: 0.20, d: 0.012 },
      { x: -0.12, z: 0.22, w: 0.24, d: 0.012, y0: 0, y1: 0.052 },
      { x: 0.12, z: -0.04, w: 0.24, d: 0.012, y0: 0.072, y1: 0.2 },
      { x: 0.12, z: -0.24, w: 0.24, d: 0.012, y0: 0, y1: 0.055 },
    ],
    start: { x: -0.38, z: -0.4, yaw: 2.38 }, goal: { x: 0.38, z: 0.4 },
    hazardPool: [[-0.18, -0.36, 'x', 0.04, 1.0], [0.18, -0.36, 'x', 0.04, 1.1], [-0.36, -0.18, 'z', 0.05, 1.0], [0.0, -0.18, 'x', 0.05, 1.2], [0.36, -0.18, 'z', 0.05, 0.9], [-0.18, 0.0, 'z', 0.05, 1.1], [0.18, 0.0, 'z', 0.05, 1.1], [-0.36, 0.18, 'z', 0.05, 1.0], [0.0, 0.18, 'x', 0.05, 1.2], [0.36, 0.18, 'z', 0.05, 0.9], [-0.15, 0.36, 'x', 0.04, 1.0], [0.15, 0.36, 'x', 0.04, 1.0]],
  },
  {
    id: 'spiral_ascent', name: 'Steps', nameKo: '계단', builtin: true,
    thickness: 0.009, hazardRange: [5, 6],
    walls: [
      { x: -0.14, z: 0.32, w: 0.56, d: 0.009 },
      { x: 0.32, z: -0.06, w: 0.009, d: 0.48 },
      { x: 0.04, z: -0.32, w: 0.48, d: 0.009 },
      { x: -0.28, z: -0.06, w: 0.009, d: 0.38 },
      { x: -0.02, z: 0.16, w: 0.36, d: 0.009, y0: 0, y1: 0.052 },
      { x: 0.16, z: -0.02, w: 0.009, d: 0.28, y0: 0.072, y1: 0.2 },
      { x: 0.02, z: -0.16, w: 0.24, d: 0.009, y0: 0, y1: 0.055 },
    ],
    start: { x: -0.41, z: -0.41, yaw: 2.36 }, goal: { x: 0, z: 0 },
    hazardPool: [[-0.2, -0.41, 'x', 0.05, 1.0], [0.18, -0.41, 'x', 0.05, 1.1], [0.41, -0.15, 'z', 0.05, 1.0], [0.41, 0.2, 'z', 0.05, 1.2], [0.15, 0.41, 'x', 0.05, 0.9], [-0.2, 0.41, 'x', 0.05, 1.1], [-0.41, 0.12, 'z', 0.05, 1.0], [-0.12, -0.25, 'x', 0.04, 1.1], [0.25, -0.05, 'z', 0.04, 1.0], [0.05, 0.25, 'x', 0.04, 1.2], [-0.24, 0.05, 'z', 0.04, 0.9], [-0.05, -0.08, 'x', 0.03, 1.1]],
  },
  {
    id: 'extreme_championship', name: 'Extreme', nameKo: '익스트림', builtin: true,
    thickness: 0.006, hazardRange: [6, 7],
    walls: [
      { x: -0.18, z: 0.30, w: 0.48, d: 0.006 },
      { x: 0.18, z: 0.10, w: 0.48, d: 0.006 },
      { x: -0.18, z: -0.10, w: 0.48, d: 0.006 },
      { x: 0.18, z: -0.30, w: 0.48, d: 0.006 },
      { x: 0.28, z: 0.30, w: 0.24, d: 0.006, y0: 0, y1: 0.052 },
      { x: -0.28, z: 0.10, w: 0.24, d: 0.006, y0: 0.072, y1: 0.2 },
      { x: 0.28, z: -0.10, w: 0.24, d: 0.006, y0: 0, y1: 0.055 },
      { x: -0.28, z: -0.30, w: 0.24, d: 0.006, y0: 0.072, y1: 0.2 },
    ],
    start: { x: -0.42, z: -0.42, yaw: 2.36 }, goal: { x: 0.42, z: 0.42 },
    hazardPool: [[-0.22, -0.42, 'x', 0.04, 1.1], [0.1, -0.42, 'x', 0.04, 1.0], [0.41, -0.33, 'z', 0.04, 1.2], [0.15, -0.25, 'x', 0.04, 1.0], [-0.18, -0.25, 'x', 0.04, 1.1], [-0.41, -0.16, 'z', 0.04, 0.9], [-0.15, -0.08, 'x', 0.04, 1.2], [0.2, -0.08, 'x', 0.04, 1.1], [0.41, 0.01, 'z', 0.04, 1.0], [0.15, 0.09, 'x', 0.04, 1.2], [-0.2, 0.09, 'x', 0.04, 1.0], [-0.41, 0.18, 'z', 0.04, 1.1], [-0.1, 0.26, 'x', 0.04, 0.9], [0.24, 0.26, 'x', 0.04, 1.2], [0.08, 0.42, 'x', 0.04, 1.1]],
  },
];

// Reference-format conversion (layout z is negated to world z by makeWorld).
export function toReferenceLayout(maze) {
  const walls = (maze.walls || []).map((w0) => {
    const w = normalizeMazeWall(w0);
    return [w.x, -w.z, w.w, w.d, w.y0, w.y1, wallTag(w)];
  });
  const obs = [...(maze.obstacles || []).map(normalizeObstacle)];
  for (const hz of maze.hazards || []) obs.push(normalizeObstacle({ kind: 'balloon', x: hz.x, z: hz.z, r: Math.min(hz.r, 0.05), y: 0.12 }));
  const [minCount, maxCount] = maze.hazardRange || [5, 7];
  // Sample stages carry verbatim reference-coord pools; otherwise synthesize.
  const pool = (maze.hazardPool && maze.hazardPool.length)
    ? maze.hazardPool.map((e) => [e[0], e[1], e[2], e[3], e[4]])
    : [];
  if (!pool.length) for (let i = 0; i < Math.max(maxCount, 1); i++) {
    const o = obs[i % Math.max(obs.length, 1)] || { x: 0, z: 0 };
    pool.push([o.x, -o.z, i % 2 === 0 ? 'x' : 'z', 0.02 + 0.01 * (i % 3), 0.6 + 0.15 * (i % 4)]);
  }
  return {
    start: [maze.start.x, -maze.start.z],
    goal: [maze.goal.x, -maze.goal.z],
    walls,
    hazards: [minCount, maxCount],
    thickness: maze.thickness || 0.016,
    hazardPool: pool,
  };
}

export const REFERENCE_MAZE_LAYOUTS = Object.fromEntries(MAZES.map((m) => [m.id, toReferenceLayout(m)]));

// Loop-ring corridor for camera-recognition tests (kept OUT of REFERENCE_MAZE_LAYOUTS,
// which holds the 10 listed stages). Rectangular ring corridor,
// centerline |coord| = 0.27, width 0.18, cruise height 0.10, one fly-over + one fly-under gate.
export const LOOP_RING_MAZE = {
  id: 'loop_ring', name: 'Loop', nameKo: '순환', builtin: true,
  thickness: 0.012, hazardRange: [3, 5],
  walls: [
    { x: 0, z: -0.36, w: 0.72, d: 0.018 },
    { x: 0, z: 0.36, w: 0.72, d: 0.018 },
    { x: -0.36, z: 0, w: 0.018, d: 0.72 },
    { x: 0.36, z: 0, w: 0.018, d: 0.72 },
    { x: 0, z: -0.18, w: 0.36, d: 0.018 },
    { x: 0, z: 0.18, w: 0.36, d: 0.018 },
    { x: -0.18, z: 0, w: 0.018, d: 0.36 },
    { x: 0.18, z: 0, w: 0.018, d: 0.36 },
    { x: 0, z: -0.27, w: 0.018, d: 0.18, y0: 0, y1: 0.08 },
    { x: 0, z: 0.27, w: 0.018, d: 0.18, y0: 0.12, y1: 0.2 },
  ],
  start: { x: -0.27, z: 0.27, yaw: 0 },
  goal: { x: 0.27, z: -0.27 },
  hazards: [{ x: 0, z: 0, r: 0.05 }, { x: -0.2, z: -0.2, r: 0.04 }],
  obstacles: [
    { kind: 'balloon', x: 0, z: 0, r: 0.032, y: 0.1 },
    { kind: 'balloon', x: 0.27, z: 0.27, r: 0.03, y: 0.14 },
  ],
  loopWaypoints: [
    [-0.27, -0.27], [0.27, -0.27], [0.27, 0.27], [-0.27, 0.27],
  ],
};
// Default editable custom maze. Ships in-code so every browser/profile has an
// editable starter even with empty localStorage (customs are local-only). The
// maze-editor page loads this as its base. A stored custom with the same id
// overrides it (see listMazes); deleting the stored copy restores this.
export const DEFAULT_CUSTOM_MAZE = {
  id: 'custom_default', name: 'Custom (editable)', nameKo: '커스텀 (수정가능)', builtin: false,
  thickness: 0.016, hazardRange: [3, 5],
  walls: [
    { x: -0.15, z: 0, w: 0.018, d: 0.4 },
    { x: 0.15, z: 0.05, w: 0.018, d: 0.4 },
    { x: 0, z: -0.28, w: 0.3, d: 0.018, y0: 0.1, y1: 0.2 },
  ],
  start: { x: -0.35, z: 0.35, yaw: 0.79 },
  goal: { x: 0.35, z: -0.35 },
  hazards: [{ x: 0, z: 0.1, r: 0.05 }],
  obstacles: [],
};
export const REFERENCE_HAZARD_POOLS = Object.fromEntries(
  MAZES.map((m) => [m.id, REFERENCE_MAZE_LAYOUTS[m.id].hazardPool])
);

export function loadCustomMazes() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    const out = (Array.isArray(arr) ? arr : []).filter((m) => m && m.id && m.id !== 'custom_imported');
    // Bridge: the sample maze-editor writes reference-format JSON here; convert once on load.
    try {
      const fly = localStorage.getItem('flymind_custom_maze_v1');
      if (fly) {
        const ref = JSON.parse(fly);
        if (ref && Array.isArray(ref.walls) && ref.start && ref.goal) out.push(referenceToCustomMaze(ref));
      }
    } catch (e2) { /* ignore malformed bridge payloads */ }
    return out;
  } catch (e) { return []; }
}

export function isReferenceMazeJson(m) {
  return !!(m && Array.isArray(m.walls) && Array.isArray(m.start) && Array.isArray(m.goal)
    && (m.walls.length === 0 || Array.isArray(m.walls[0])));
}
export function referenceToCustomMaze(ref) {
  const sx = +ref.start[0] || 0, sz = -(+ref.start[1] || 0);
  const gx = +ref.goal[0] || 0, gz = -(+ref.goal[1] || 0);
  return {
    id: 'custom_imported', name: 'Custom Editor Maze', nameKo: '커스텀 디자인 미로 (Editor)', builtin: false,
    thickness: +ref.thickness || 0.016,
    hazardRange: Array.isArray(ref.hazards) ? ref.hazards : [5, 7],
    start: { x: sx, z: sz, yaw: Math.atan2(gx - sx, -(gz - sz)) },
    goal: { x: gx, z: gz },
    walls: ref.walls.map(([x, z, w, d, y0, y1]) => ({ x, z: -z, w, d, y0, y1 })),
  };
}

export function listMazes() {
  const customs = loadCustomMazes();
  const overridden = customs.some((m) => m.id === DEFAULT_CUSTOM_MAZE.id);
  return [...MAZES, LOOP_RING_MAZE, ...(overridden ? [] : [DEFAULT_CUSTOM_MAZE]), ...customs];
}

export function getMaze(id) {
  return listMazes().find((m) => m.id === id) || null;
}

export function getReferenceLayout(id) {
  if (REFERENCE_MAZE_LAYOUTS[id]) return REFERENCE_MAZE_LAYOUTS[id];
  const custom = getMaze(id);
  return custom ? toReferenceLayout(custom) : REFERENCE_MAZE_LAYOUTS.complex;
}

export function mazeObstacles(maze) {
  const obs = (maze.obstacles || []).map(normalizeObstacle);
  for (const hz of maze.hazards || []) {
    obs.push(normalizeObstacle({ kind: 'ring', x: hz.x, z: hz.z, r: hz.r }));
  }
  return obs;
}

export function saveCustomMaze(maze) {
  const arr = loadCustomMazes().filter((m) => m.id !== maze.id);
  arr.push({ ...maze, builtin: false, updatedAt: new Date().toISOString() });
  try { localStorage.setItem(STORE_KEY, JSON.stringify(arr)); } catch (e) { /* private mode: keep in-memory */ }
  return arr;
}

export function deleteCustomMaze(id) {
  const arr = loadCustomMazes().filter((m) => m.id !== id);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(arr)); } catch (e) { /* noop */ }
  return arr;
}
