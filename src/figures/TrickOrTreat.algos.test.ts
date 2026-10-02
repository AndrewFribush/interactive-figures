import { describe, expect, it, vi } from 'vitest';
import { BULB_R, SETBACK, makeTown, segDist, type Town } from './TrickOrTreat.town';
import { ALGOS, planAll, planExact, routeHaul, routeMinutes } from './TrickOrTreat.algos';

// Brute force, independent of the branch and bound: a DP over subsets of
// the lit houses, the fewest minutes to visit a subset ending at each
// house; a subset counts when that plus the walk home fits the curfew.
function bruteBest(t: Town): number {
  const H = t.houses.length;
  const ids = t.houses.filter((h) => h.value > 0).map((h) => h.id);
  const n = ids.length;
  const INF = 1e9;
  const dp = Array.from({ length: 1 << n }, () => new Array(n).fill(INF));
  for (let i = 0; i < n; i++) dp[1 << i][i] = t.D[H][ids[i]];
  let best = 0;
  for (let m = 1; m < 1 << n; m++) {
    let v = 0;
    for (let i = 0; i < n; i++) if (m & (1 << i)) v += t.houses[ids[i]].value;
    for (let i = 0; i < n; i++) {
      const d = dp[m][i];
      if (d >= INF) continue;
      if (d + t.D[ids[i]][H] <= t.curfew && v > best) best = v;
      for (let j = 0; j < n; j++) {
        if (m & (1 << j)) continue;
        const nd = d + t.D[ids[i]][ids[j]];
        if (nd < dp[m | (1 << j)][j]) dp[m | (1 << j)][j] = nd;
      }
    }
  }
  return best;
}

const SEEDS = Array.from({ length: 12 }, (_, i) => i * 7919 + 15);

describe('trick-or-treat: the generator', () => {
  it('reproduces a town from its seed', () => {
    expect(makeTown(42, 'wide')).toEqual(makeTown(42, 'wide'));
    expect(makeTown(42, 'wide').houses.map((h) => h.lot)).not.toEqual(makeTown(43, 'wide').houses.map((h) => h.lot));
  });

  for (const size of ['compact', 'wide', 'side'] as const)
    it(`is connected, every house reachable, no zero-minute hops, no house off the street (${size})`, () => {
      for (const seed of SEEDS) {
        const t = makeTown(seed, size);
        const H = t.houses.length;
        expect(H).toBeGreaterThanOrEqual({ compact: 10, wide: 14, side: 18 }[size]);
        expect(t.streets.some((s) => s.kind === 'court')).toBe(true);
        for (let i = 0; i <= H; i++)
          for (let j = 0; j <= H; j++) {
            expect(Number.isFinite(t.D[i][j])).toBe(true);
            expect(t.D[i][j]).toBe(t.D[j][i]);
            if (i !== j) expect(t.D[i][j]).toBeGreaterThanOrEqual(1);
            for (let k = 0; k <= H; k++) expect(t.D[i][j]).toBeLessThanOrEqual(t.D[i][k] + t.D[k][j]);
          }
        // Every house is reachable from home and back.
        for (const h of t.houses) expect(t.legs[H][h.id].length).toBeGreaterThan(0);
        // Every house stands its setback from its own street and clear of every other one.
        for (const h of t.houses) {
          const own = t.streets[h.street];
          const segs = own.nodes.slice(1).map((v, k) => [own.nodes[k], v]);
          if (own.closed) segs.push([own.nodes[own.nodes.length - 1], own.nodes[0]]);
          const dOwn = Math.min(...segs.map(([a, b]) => segDist(h.lot, t.pts[a], t.pts[b])));
          expect(dOwn).toBeLessThanOrEqual((h.bulb ? BULB_R + 0.58 : SETBACK) + 1e-3);
          for (const s of t.streets) {
            if (s.id === h.street) continue;
            const ss = s.nodes.slice(1).map((v, k) => [s.nodes[k], v]);
            if (s.closed) ss.push([s.nodes[s.nodes.length - 1], s.nodes[0]]);
            for (const [a, b] of ss) expect(segDist(h.lot, t.pts[a], t.pts[b])).toBeGreaterThan(SETBACK);
          }
        }
        // No two houses on one lot.
        for (const a of t.houses) for (const b of t.houses) if (a.id < b.id) expect(Math.hypot(a.lot.x - b.lot.x, a.lot.y - b.lot.y)).toBeGreaterThan(0.95);
      }
    });
});

describe('trick-or-treat: the planners', () => {
  for (const seed of SEEDS.slice(0, 8))
    it(`exact matches brute force on a small board and bounds every heuristic, seed ${seed}`, () => {
      const t = makeTown(seed, 'compact', { houses: 11 });
      const plans = planAll(t);
      const best = bruteBest(t);
      expect(plans.exact.proved).toBe(true);
      expect(plans.exact.haul).toBe(best);
      for (const { key } of ALGOS) {
        expect(routeMinutes(t, plans[key].route)).toBeLessThanOrEqual(t.curfew);
        expect(plans[key].haul).toBe(routeHaul(t, plans[key].route));
        expect(plans[key].haul).toBeLessThanOrEqual(best);
        expect(new Set(plans[key].route).size).toBe(plans[key].route.length);
        expect(plans[key].frames.length).toBeGreaterThan(0);
      }
    });

  for (const size of ['compact', 'wide', 'side'] as const)
    it(`every route is home by curfew and no heuristic beats exact (${size})`, () => {
      for (const seed of SEEDS) {
        const t = makeTown(seed, size);
        const t0 = performance.now();
        const plans = planAll(t);
        expect(performance.now() - t0).toBeLessThan(2500);
        for (const { key } of ALGOS) {
          expect(routeMinutes(t, plans[key].route)).toBeLessThanOrEqual(t.curfew);
          expect(plans[key].haul).toBeLessThanOrEqual(plans.exact.haul);
        }
      }
    });

  // The default board is drawn on the server and again in the browser; if
  // exact read a clock the two could stop at different places and the
  // hydrated figure would disagree with the first paint.
  it('plans the same routes whatever the clock says (hydration)', () => {
    for (const size of ['compact', 'wide', 'side'] as const) {
      const t = makeTown(15, size);
      const fast = planAll(t);
      let tick = 0;
      const perf = vi.spyOn(performance, 'now').mockImplementation(() => (tick += 1e6));
      const date = vi.spyOn(Date, 'now').mockImplementation(() => (tick += 1e6));
      const slow = planAll(t);
      perf.mockRestore();
      date.mockRestore();
      expect(slow).toEqual(fast);
      expect(slow.exact.proved).toBe(true);
    }
  });

  it('stops and says so instead of hanging when the cap is hit', () => {
    const t = makeTown(15, 'wide');
    const p = planExact(t, [], 50);
    expect(p.proved).toBe(false);
    expect(p.stopped).toMatch(/50 PARTIAL ROUTES/);
    expect(p.frames[p.frames.length - 1].text).toMatch(/NOT PROVED/);
    expect(routeMinutes(t, p.route)).toBeLessThanOrEqual(t.curfew);
  });
});
