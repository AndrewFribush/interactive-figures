import { BULB_R, type Pt, type Town } from './TrickOrTreat.town';

// Display geometry only: routes, rewards, and the generated town stay unchanged.
export const HOUSE_A = 0.28;
export const HOUSE_B = 0.22;
export const WALL_HEIGHT = 0.14;
export const ROOF_HEIGHT = 0.18;
const SQ3 = Math.sqrt(3) / 2;
const project = (p: Pt, z = 0): Pt => ({ x: (p.x - p.y) * SQ3, y: (p.x + p.y) / 2 - z });
const cross = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Spread nearby costumes horizontally, preserving each group's original centre. */
export function spreadWalkers(points: readonly Pt[], gap: number): Pt[] {
  const out = points.map((p) => ({ ...p }));
  const parent = points.map((_, i) => i);
  const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]));
  const needed = (i: number, j: number) => Math.sqrt(Math.max(0, gap * gap - ((points[i].y - points[j].y) * 0.45) ** 2));
  // A widened group can meet another group; each pass merges at least two
  // groups, so no more than n passes are needed, including the final check.
  for (let pass = 0; pass < points.length; pass++) {
    let merged = false;
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      if (root(i) !== root(j) && Math.abs(out[i].x - out[j].x) < needed(i, j) - 1e-9) {
        parent[root(j)] = root(i);
        merged = true;
      }
    }
    if (!merged) break;
    const groups = new Map<number, number[]>();
    points.forEach((_, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), i]));
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort((i, j) => points[i].x - points[j].x || i - j);
      for (let k = 0; k < group.length; k++) {
        const i = group[k];
        out[i].x = points[i].x;
        for (let j = 0; j < k; j++) {
          const space = needed(i, group[j]);
          if (space > 0) out[i].x = Math.max(out[i].x, out[group[j]].x + space);
        }
      }
      const shift = group.reduce((sum, i) => sum + out[i].x - points[i].x, 0) / group.length;
      for (const i of group) out[i].x -= shift;
    }
  }
  return out;
}

function hull(points: Pt[]): Pt[] {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (ps: Pt[]) => {
    const out: Pt[] = [];
    for (const p of ps) {
      while (out.length > 1 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  return half(sorted).slice(0, -1).concat(half(sorted.reverse()).slice(0, -1));
}

/** Convex silhouette in screen coordinates at scale 1, including the roof. */
export function houseOutline(lot: Pt, tan: Pt, nrm: Pt, home = false): Pt[] {
  const a = HOUSE_A * (home ? 1.15 : 1);
  const b = HOUSE_B * (home ? 1.15 : 1);
  const wall = WALL_HEIGHT * (home ? 1.1 : 1);
  const p = (u: number, v: number, z: number) => project({ x: lot.x + tan.x * a * u + nrm.x * b * v, y: lot.y + tan.y * a * u + nrm.y * b * v }, z);
  const points: Pt[] = [];
  for (const u of [-1, 1]) for (const v of [-1, 1]) points.push(p(u, v, 0), p(u, v, wall));
  const alongTan = Math.abs(tan.x + tan.y) >= Math.abs(nrm.x + nrm.y);
  for (const k of [-1, 1]) points.push(p(alongTan ? k : 0, alongTan ? 0 : k, wall + ROOF_HEIGHT));
  return hull(points);
}

function pointSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

const inside = (p: Pt, shape: Pt[]) => shape.every((a, i) => cross(a, shape[(i + 1) % shape.length], p) >= -1e-10);
function segmentDistance(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const ac = cross(a, b, c);
  const ad = cross(a, b, d);
  const ca = cross(c, d, a);
  const cb = cross(c, d, b);
  // Collinear, disjoint edges still need their endpoint distances.
  if (ac * ad < 0 && ca * cb < 0) return 0;
  return Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b));
}

function shapeSegment(shape: Pt[], a: Pt, b: Pt): number {
  if (inside(a, shape) || inside(b, shape)) return 0;
  return Math.min(...shape.map((p, i) => segmentDistance(p, shape[(i + 1) % shape.length], a, b)));
}

function shapeDistance(a: Pt[], b: Pt[]): number {
  if (inside(a[0], b) || inside(b[0], a)) return 0;
  return Math.min(...b.map((p, i) => shapeSegment(a, p, b[(i + 1) % b.length])));
}

/** Place the drawing beside its existing streets; never change the walking graph. */
export function layoutHouses(town: Town, scale: number): { houses: Pt[]; home: Pt } {
  const gap = 2 / scale;
  const roadRadius = Math.max(3 / scale, 0.18) + 1 / scale + gap;
  const roads = town.streets.flatMap((street) => street.nodes.flatMap((node, i) => i + 1 < street.nodes.length || street.closed ? [[project(town.pts[node]), project(town.pts[street.nodes[(i + 1) % street.nodes.length]])] as const] : []));
  const bulbs = town.bulbs.map(({ at }) => project(at));
  const bulbX = BULB_R * Math.SQRT2 * SQ3 + 1 / scale + gap;
  const bulbY = BULB_R * Math.SQRT2 / 2 + 1 / scale + gap;
  const placed: Pt[][] = [];
  const offsets = [0, -0.12, 0.12, -0.25, 0.25, 0.4, 0.6, 0.85, 1.15, 1.5, 2, 2.75];
  const shifts = [0, 0.18, -0.18, 0.36, -0.36, 0.6, -0.6, 0.9, -0.9, 1.3, -1.3, 1.8, -1.8];
  const candidates = offsets.flatMap((out) => shifts.map((along) => ({ out, along, cost: out * out + along * along * 1.5 }))).sort((a, b) => a.cost - b.cost);
  const clear = (shape: Pt[]) => {
    if (roads.some(([a, b]) => shapeSegment(shape, a, b) < roadRadius)) return false;
    if (bulbs.some((p) => {
      const ellipseSpace = shape.map((q) => ({ x: (q.x - p.x) / bulbX, y: (q.y - p.y) / bulbY }));
      return inside({ x: 0, y: 0 }, ellipseSpace) || ellipseSpace.some((q, i) => pointSegment({ x: 0, y: 0 }, q, ellipseSpace[(i + 1) % ellipseSpace.length]) < 1);
    })) return false;
    return placed.every((other) => shapeDistance(shape, other) >= gap);
  };
  const place = (house: { lot: Pt; tan: Pt; nrm: Pt; bulb?: boolean }, home = false): Pt => {
    const base = home ? 0.35 : house.bulb ? 0.15 : 0.3;
    for (const { out, along } of candidates) {
      const lot = { x: house.lot.x + house.nrm.x * (base + out) + house.tan.x * along, y: house.lot.y + house.nrm.y * (base + out) + house.tan.y * along };
      const shape = houseOutline(lot, house.tan, house.nrm, home);
      if (clear(shape)) {
        placed.push(shape);
        return lot;
      }
    }
    // Extremely cramped towns may exhaust nearby slots. Put this drawing just
    // beyond the occupied extent along its own street normal, never on a road.
    // The component fits the final display lots, so the fallback stays visible.
    const direction = project(house.nrm);
    const axis = Math.abs(direction.x) >= Math.abs(direction.y) ? 'x' : 'y';
    const positive = direction[axis] > 0;
    const occupied = [...roads.flat(), ...bulbs, ...placed.flat()].map((p) => p[axis]);
    const shape = houseOutline(house.lot, house.tan, house.nrm, home);
    const padding = Math.max(roadRadius, bulbX, bulbY) + gap;
    const edge = positive ? Math.max(...occupied) + padding : Math.min(...occupied) - padding;
    const near = positive ? Math.min(...shape.map((p) => p[axis])) : Math.max(...shape.map((p) => p[axis]));
    const outward = Math.max(base, (edge - near) / direction[axis] + 0.01);
    const lot = { x: house.lot.x + house.nrm.x * outward, y: house.lot.y + house.nrm.y * outward };
    placed.push(houseOutline(lot, house.tan, house.nrm, home));
    return lot;
  };
  const home = place(town.home, true);
  const houses = town.houses.map((house) => place(house));
  return { houses, home };
}
