// NSP 3D — lab/astar.js (dependency-free voxel A* + ground-truth clearance rays).
// Baseline path planner for the vision lab: optimal centerline reference that the
// camera-driven trajectories are compared against.
export function buildVoxelGrid(obstacles, { cell = 0.02, margin = 0.012 } = {}) {
  const nx = Math.round(1 / cell), ny = Math.round(0.2 / cell), nz = Math.round(1 / cell);
  const blocked = new Uint8Array(nx * ny * nz);
  const idx = (ix, iy, iz) => (iz * ny + iy) * nx + ix;
  const center = (ix, iy, iz) => ({ x: -0.5 + (ix + 0.5) * cell, y: (iy + 0.5) * cell, z: -0.5 + (iz + 0.5) * cell });
  const toCell = (p) => [
    Math.max(0, Math.min(nx - 1, Math.floor((p.x + 0.5) / cell))),
    Math.max(0, Math.min(ny - 1, Math.floor(p.y / cell))),
    Math.max(0, Math.min(nz - 1, Math.floor((p.z + 0.5) / cell))),
  ];
  const pointBlocked = (p) => {
    for (const ob of obstacles || []) {
      if (ob.hx !== undefined) {
        if (Math.abs(p.x - ob.x) <= ob.hx + margin && Math.abs(p.y - ob.y) <= ob.hy + margin && Math.abs(p.z - ob.z) <= ob.hz + margin) return true;
      } else if (ob.radius !== undefined) {
        if (Math.hypot(p.x - ob.x, p.y - ob.y, p.z - ob.z) <= ob.radius + margin) return true;
      }
    }
    return false;
  };
  for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    if (pointBlocked(center(ix, iy, iz))) blocked[idx(ix, iy, iz)] = 1;
  }
  return { cell, nx, ny, nz, blocked, idx, center, toCell, pointBlocked };
}

const DIRS26 = [];
for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
  if (!dx && !dy && !dz) continue;
  DIRS26.push([dx, dy, dz]);
}

export function astar(grid, start, goal) {
  const { nx, ny, nz, blocked, idx, center, toCell, cell } = grid;
  const s = toCell(start), g = toCell(goal);
  const si = idx(s[0], s[1], s[2]), gi = idx(g[0], g[1], g[2]);
  if (blocked[si] || blocked[gi]) return null;
  const stepCost = ([dx, dy, dz]) => Math.hypot(dx * cell, dy * cell, dz * cell);
  const hOf = (ix, iy, iz) => Math.hypot((ix - g[0]) * cell, (iy - g[1]) * cell, (iz - g[2]) * cell);
  const open = [{ i: si, c: s, f: hOf(s[0], s[1], s[2]) }];
  const came = new Map(), cost = new Map([[si, 0]]);
  const key = (ix, iy, iz) => idx(ix, iy, iz);
  const free = (ix, iy, iz) => ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz && !blocked[key(ix, iy, iz)];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.i === gi) {
      const cells = [cur.c];
      let k = cur.i;
      while (came.has(k)) { k = came.get(k); cells.push([k % nx, Math.floor(k / nx) % ny, Math.floor(k / (nx * ny))]); }
      cells.reverse();
      return cells.map(([ix, iy, iz]) => center(ix, iy, iz));
    }
    for (const [dx, dy, dz] of DIRS26) {
      const nix = cur.c[0] + dx, niy = cur.c[1] + dy, niz = cur.c[2] + dz;
      if (!free(nix, niy, niz)) continue;
      // No corner cutting through blocked orthogonal neighbors.
      if (dx && dy && (!free(cur.c[0] + dx, cur.c[1], cur.c[2]) || !free(cur.c[0], cur.c[1] + dy, cur.c[2]))) continue;
      if (dx && dz && (!free(cur.c[0] + dx, cur.c[1], cur.c[2]) || !free(cur.c[0], cur.c[1], cur.c[2] + dz))) continue;
      if (dy && dz && (!free(cur.c[0], cur.c[1] + dy, cur.c[2]) || !free(cur.c[0], cur.c[1], cur.c[2] + dz))) continue;
      const ni = key(nix, niy, niz);
      const ng = cost.get(cur.i) + stepCost([dx, dy, dz]);
      if (ng < (cost.get(ni) ?? Infinity)) {
        cost.set(ni, ng);
        came.set(ni, cur.i);
        open.push({ i: ni, c: [nix, niy, niz], f: ng + hOf(nix, niy, niz) });
      }
    }
  }
  return null;
}

export function segmentBlocked(grid, a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const steps = Math.max(1, Math.ceil(len / (grid.cell / 2)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (grid.pointBlocked({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })) return true;
  }
  return false;
}

export function smoothPath(grid, path) {
  if (!path || path.length < 3) return path;
  const out = [path[0]];
  let anchor = 0;
  while (anchor < path.length - 1) {
    let far = path.length - 1;
    while (far > anchor + 1 && segmentBlocked(grid, path[anchor], path[far])) far--;
    out.push(path[far]);
    anchor = far;
  }
  return out;
}

export function pathLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z);
  return len;
}

// Analytic ray vs chamber boxes/spheres. Returns clearance in [0, maxDist].
// ignoreY skips the floor/ceiling planes (matches the z_depth shader filter).
export function rayClearance(obstacles, origin, dir, maxDist = 0.6, ignoreY = false) {
  let best = maxDist;
  // Chamber bounds.
  const axes = ignoreY
    ? [[origin.x, dir.x, -0.5, 0.5], [origin.z, dir.z, -0.5, 0.5]]
    : [[origin.x, dir.x, -0.5, 0.5], [origin.y, dir.y, 0, 0.2], [origin.z, dir.z, -0.5, 0.5]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) continue;
    const t = ((d > 0 ? hi : lo) - o) / d;
    if (t > 0 && t < best) best = t;
  }
  for (const ob of obstacles || []) {
    if (ob.hx !== undefined) {
      let tmin = 0, tmax = best;
      const o = [origin.x - ob.x, origin.y - ob.y, origin.z - ob.z], dd = [dir.x, dir.y, dir.z], h = [ob.hx, ob.hy, ob.hz];
      for (let a = 0; a < 3; a++) {
        if (Math.abs(dd[a]) < 1e-12) { if (Math.abs(o[a]) > h[a]) { tmin = Infinity; break; } continue; }
        let t1 = (-h[a] - o[a]) / dd[a], t2 = (h[a] - o[a]) / dd[a];
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) break;
      }
      if (tmin > 0 && tmin <= tmax && tmin < best) best = tmin;
    } else if (ob.radius !== undefined) {
      const ox = origin.x - ob.x, oy = origin.y - ob.y, oz = origin.z - ob.z;
      const b = ox * dir.x + oy * dir.y + oz * dir.z;
      const c = ox * ox + oy * oy + oz * oz - ob.radius * ob.radius;
      const disc = b * b - c;
      if (disc > 0) {
        const t = -b - Math.sqrt(disc);
        if (t > 0 && t < best) best = t;
      }
    }
  }
  return best;
}

// Representative rays for the 5 camera sectors (approximation of the zone centers).
// yaw convention: forward F = (sin yaw, 0, -cos yaw).
export function sectorRays(yaw, pitch = 0) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fwd = { x: Math.sin(yaw) * cp, y: sp, z: -Math.cos(yaw) * cp };
  const rotY = (v, a) => ({ x: v.x * Math.cos(a) + v.z * Math.sin(a), y: v.y, z: -v.x * Math.sin(a) + v.z * Math.cos(a) });
  const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
  const el = (v, e) => {
    const horiz = Math.hypot(v.x, v.z) || 1;
    const base = Math.asin(Math.max(-1, Math.min(1, v.y / (Math.hypot(v.x, v.y, v.z) || 1))));
    const ne = base + e;
    return { x: (v.x / horiz) * Math.cos(ne), y: Math.sin(ne), z: (v.z / horiz) * Math.cos(ne) };
  };
  return {
    left: norm(rotY({ ...fwd, y: 0 }, 0.7)),
    right: norm(rotY({ ...fwd, y: 0 }, -0.7)),
    front: norm({ ...fwd }),
    up: el(fwd, 0.6),
    down: el(fwd, -0.6),
  };
}

export function groundTruthClearance(obstacles, pos, yaw, pitch = 0, maxDist = 0.6, ignoreY = false) {
  const rays = sectorRays(yaw, pitch);
  const out = {};
  for (const [k, d] of Object.entries(rays)) out[k] = rayClearance(obstacles, pos, d, maxDist, ignoreY);
  return out;
}
