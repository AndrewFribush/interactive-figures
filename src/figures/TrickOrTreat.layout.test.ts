import { describe, expect, it } from 'vitest';
import { houseOutline, layoutHouses, spreadWalkers } from './TrickOrTreat.layout';
import { BULB_R, makeTown, type Pt, type Town } from './TrickOrTreat.town';

const project = (p: Pt): Pt => ({ x: (p.x - p.y) * Math.sqrt(3) / 2, y: (p.x + p.y) / 2 });

// Independent separating-axis check against the actual visible geometry.
// Production uses edge distances; this checks polygon interiors instead.
function overlaps(a: Pt[], b: Pt[]): boolean {
  for (const shape of [a, b]) for (let i = 0; i < shape.length; i++) {
    const p = shape[i];
    const q = shape[(i + 1) % shape.length];
    const axis = { x: p.y - q.y, y: q.x - p.x };
    const ap = a.map((v) => v.x * axis.x + v.y * axis.y);
    const bp = b.map((v) => v.x * axis.x + v.y * axis.y);
    if (Math.max(...ap) <= Math.min(...bp) || Math.max(...bp) <= Math.min(...ap)) return false;
  }
  return true;
}

const ellipse = (p: Pt, rx: number, ry = rx): Pt[] => Array.from({ length: 24 }, (_, i) => ({ x: p.x + rx * Math.cos(i * Math.PI / 12), y: p.y + ry * Math.sin(i * Math.PI / 12) }));

function roadShapes(town: Town, scale: number): Pt[][] {
  const radius = Math.max(3 / scale, 0.18) + 1 / scale;
  const shapes: Pt[][] = [];
  for (const street of town.streets) for (let i = 0; i < street.nodes.length; i++) {
    if (i + 1 === street.nodes.length && !street.closed) continue;
    const a = project(town.pts[street.nodes[i]]);
    const b = project(town.pts[street.nodes[(i + 1) % street.nodes.length]]);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const x = (b.y - a.y) / length * radius;
    const y = (a.x - b.x) / length * radius;
    shapes.push([{ x: a.x + x, y: a.y + y }, { x: b.x + x, y: b.y + y }, { x: b.x - x, y: b.y - y }, { x: a.x - x, y: a.y - y }], ellipse(a, radius), ellipse(b, radius));
  }
  for (const bulb of town.bulbs) shapes.push(ellipse(project(bulb.at), BULB_R * Math.sqrt(1.5) + 1 / scale, BULB_R * Math.SQRT1_2 + 1 / scale));
  return shapes;
}

function collisions(town: Town, scale: number): string[] {
  const layout = layoutHouses(town, scale);
  const shapes = [houseOutline(layout.home, town.home.tan, town.home.nrm, true), ...town.houses.map((h, i) => houseOutline(layout.houses[i], h.tan, h.nrm))];
  const roads = roadShapes(town, scale);
  const issues: string[] = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) if (overlaps(shapes[i], shapes[j])) issues.push(`houses ${i}/${j}`);
    if (roads.some((road) => overlaps(shapes[i], road))) issues.push(`house ${i}/street`);
  }
  return issues;
}

describe('trick-or-treat display placement', () => {
  it('leaves house identities, rewards, street geometry and route distances untouched', () => {
    const town = makeTown(78, 'wide');
    const before = structuredClone(town);
    const layout = layoutHouses(town, 28);
    expect(town).toEqual(before);
    expect(layout.houses).toHaveLength(town.houses.length);
    expect(layoutHouses(town, 28)).toEqual(layout);
    expect(layout.houses.some((lot, i) => lot.x !== town.houses[i].lot.x || lot.y !== town.houses[i].lot.y)).toBe(true);
  });

  for (const [size, scale] of [['compact', 18], ['wide', 23], ['side', 18], ['side', 35]] as const) {
    it(`keeps seed 78 roofs clear of every house, curb and turning bulb at ${size}/${scale}`, () => {
      expect(collisions(makeTown(78, size), scale)).toEqual([]);
    });

    it(`keeps 100 generated ${size} towns clear at display scale ${scale}`, () => {
      const failures = Array.from({ length: 100 }, (_, seed) => ({ seed, issues: collisions(makeTown(seed, size), scale) })).filter(({ issues }) => issues.length);
      expect(failures).toEqual([]);
    });
  }

  it('uses a clear outer position when a compact town exhausts nearby slots', () => {
    expect(collisions(makeTown(289, 'compact'), 20)).toEqual([]);
  });

  it('actually detects a roof crossing a street in the original placement', () => {
    const town = makeTown(78, 'wide');
    const shapes = town.houses.map((h) => houseOutline(h.lot, h.tan, h.nrm));
    expect(shapes.some((shape) => roadShapes(town, 28).some((road) => overlaps(shape, road)))).toBe(true);
  });
});

describe('walker spacing', () => {
  const gap = 10;
  const check = (points: Pt[]) => {
    const before = structuredClone(points);
    const spread = spreadWalkers(points, gap);
    expect(points).toEqual(before);
    expect(spread.map((p) => p.y)).toEqual(points.map((p) => p.y));
    expect(spread.reduce((sum, p) => sum + p.x, 0)).toBeCloseTo(points.reduce((sum, p) => sum + p.x, 0), 8);
    for (let i = 0; i < spread.length; i++) for (let j = i + 1; j < spread.length; j++) {
      expect(Math.hypot(spread[i].x - spread[j].x, (spread[i].y - spread[j].y) * 0.45)).toBeGreaterThanOrEqual(gap - 1e-8);
    }
    return spread;
  };

  it('moves reversed x positions apart instead of together', () => {
    expect(check([{ x: 4, y: 0 }, { x: 0, y: 0 }])).toEqual([{ x: 7, y: 0 }, { x: -3, y: 0 }]);
  });

  it('gives all six coincident walkers distinct positions around their centre', () => {
    expect(check(Array.from({ length: 6 }, () => ({ x: 0, y: 2 }))).map((p) => p.x)).toEqual([-25, -15, -5, 5, 15, 25]);
  });

  it('resolves an overlapping chain with different heights', () => {
    check([{ x: 12, y: 4 }, { x: 0, y: 0 }, { x: 6, y: 2 }, { x: 18, y: 0 }]);
  });

  it('merges an expanded group when it reaches a previously separate walker', () => {
    const spread = check([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 24, y: 0 }]);
    expect(spread[4].x).toBeGreaterThan(24);
  });

  it('leaves separated input unchanged', () => {
    const points = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 0, y: 30 }];
    expect(check(points)).toEqual(points);
  });
});
