// Trick-or-treat (fig 1.1.15): the five planners, on a generated town.
//
// The problem is orienteering with a return: leave home, knock on houses in
// some order, collect each house's candy once, and be home by curfew (the
// rule from sketch A). A route is the ordered list of house ids; home is
// implied at both ends. Each planner returns its route and the frames of
// its decisions, so the figure can step through how it got there. Nobody
// knocks at a dark porch (a toothbrush house), since its light is off.
// Pure functions, no React.

import { TREATS, rng, streetName } from './TrickOrTreat.town';
import type { Town } from './TrickOrTreat.town';

export type AlgoKey = 'nearest' | 'ratio' | 'twoopt' | 'anneal' | 'exact';

export const ALGOS: readonly { key: AlgoKey; label: string; short: string }[] = [
  { key: 'nearest', label: 'NEAREST HOUSE', short: 'NEAREST' },
  { key: 'ratio', label: 'BEST CANDY PER STEP', short: 'PER STEP' },
  { key: 'twoopt', label: 'GREEDY + 2-OPT', short: '2-OPT' },
  { key: 'anneal', label: 'SIMULATED ANNEALING', short: 'ANNEALING' },
  { key: 'exact', label: 'EXACT', short: 'EXACT' },
];

/** One decision: the route as the planner holds it, where it stands, and the house in question. */
export interface Frame {
  route: number[];
  /** A house id, or -1 for home. */
  at: number;
  consider: number | null;
  /** Machine voice, one line. */
  text: string;
}

export interface Plan {
  key: AlgoKey;
  route: number[];
  haul: number;
  minutes: number;
  frames: Frame[];
  /** Exact only: true when the search finished, so the haul is proved the most possible. */
  proved?: boolean;
  tried?: number;
  /** Exact only: why it stopped, when it did. */
  stopped?: string;
}

export const homeIx = (t: Town) => t.houses.length;

/** Minutes for the whole loop: home, the houses in order, home. */
export function routeMinutes(t: Town, route: readonly number[]): number {
  const H = homeIx(t);
  let at = H;
  let m = 0;
  for (const h of route) {
    m += t.D[at][h];
    at = h;
  }
  return m + (route.length ? t.D[at][H] : 0);
}

export const routeHaul = (t: Town, route: readonly number[]) => route.reduce((s, h) => s + t.houses[h].value, 0);

export const feasible = (t: Town, route: readonly number[]) => routeMinutes(t, route) <= t.curfew;

/** Arrival minute at each stop, then the minute it is home. */
export function arrivals(t: Town, route: readonly number[]): { stops: number[]; home: number } {
  const H = homeIx(t);
  let at = H;
  let m = 0;
  const stops: number[] = [];
  for (const h of route) {
    m += t.D[at][h];
    stops.push(m);
    at = h;
  }
  return { stops, home: m + (route.length ? t.D[at][H] : 0) };
}

const MAX_FRAMES = 40;
const tname = (t: Town, h: number) => TREATS[t.houses[h].treat].name;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function finish(t: Town, key: AlgoKey, route: number[], frames: Frame[], extra: Partial<Plan> = {}): Plan {
  let fr = frames;
  if (fr.length > MAX_FRAMES) {
    const step = (fr.length - 1) / (MAX_FRAMES - 1);
    fr = Array.from({ length: MAX_FRAMES }, (_, k) => fr[Math.round(k * step)]);
  }
  return { key, route, haul: routeHaul(t, route), minutes: routeMinutes(t, route), frames: fr, ...extra };
}

/** Walk-as-you-go: from where it stands, the best-scored lit house that still gets it home by curfew. */
function constructive(t: Town, key: 'nearest' | 'ratio'): Plan {
  const H = homeIx(t);
  const { D, curfew } = t;
  const route: number[] = [];
  const frames: Frame[] = [];
  const seen = new Set<number>();
  let at = H;
  let m = 0;
  for (;;) {
    let best = -1;
    let bestS = -Infinity;
    for (const h of t.houses) {
      if (seen.has(h.id) || h.value === 0) continue;
      if (m + D[at][h.id] + D[h.id][H] > curfew) continue;
      const s = key === 'nearest' ? -D[at][h.id] : h.value / D[at][h.id];
      if (s > bestS + 1e-12) {
        bestS = s;
        best = h.id;
      }
    }
    if (best < 0) break;
    const d = D[at][best];
    const v = t.houses[best].value;
    const why = key === 'nearest' ? `THE CLOSEST LIT PORCH` : `${v} CANDY FOR ${d} MIN, ${(v / d).toFixed(1)} A MINUTE, THE BEST RATE IN REACH`;
    frames.push({
      route: [...route],
      at: route.length ? route[route.length - 1] : -1,
      consider: best,
      text: `STOP ${route.length + 1}: ${streetName(t, best)}, ${2 * d} MIN ROUND TRIP, ${tname(t, best)}. ${why}`,
    });
    route.push(best);
    seen.add(best);
    m += d;
    at = best;
  }
  frames.push({ route: [...route], at: route.length ? route[route.length - 1] : -1, consider: null, text: `NOTHING ELSE GETS IT HOME BY CURFEW: HOME AT MINUTE ${routeMinutes(t, route)} WITH ${routeHaul(t, route)} CANDY` });
  return finish(t, key, route, frames);
}

export const planNearest = (t: Town) => constructive(t, 'nearest');
export const planRatio = (t: Town) => constructive(t, 'ratio');

/** The best 2-opt reversal of a closed tour (home fixed at both ends); null when none shortens it. */
function bestTwoOpt(t: Town, route: number[]): { route: number[]; saved: number; touched: number } | null {
  const H = homeIx(t);
  const n = route.length;
  const at = (k: number) => (k < 0 || k >= n ? H : route[k]);
  let best: { i: number; j: number; saved: number } | null = null;
  for (let i = 0; i < n - 1; i++)
    for (let j = i + 1; j < n; j++) {
      const before = t.D[at(i - 1)][at(i)] + t.D[at(j)][at(j + 1)];
      const after = t.D[at(i - 1)][at(j)] + t.D[at(i)][at(j + 1)];
      if (before - after > (best?.saved ?? 0) + 1e-9) best = { i, j, saved: before - after };
    }
  if (!best) return null;
  const { i, j, saved } = best;
  return { route: [...route.slice(0, i), ...route.slice(i, j + 1).reverse(), ...route.slice(j + 1)], saved, touched: route[j] };
}

/** The best-paying lit house to slot in somewhere, value per added minute, that keeps the tour within curfew. */
function bestInsertion(t: Town, route: number[]): { route: number[]; id: number; add: number } | null {
  const H = homeIx(t);
  const len = routeMinutes(t, route);
  const inR = new Set(route);
  let best: { route: number[]; id: number; add: number; s: number } | null = null;
  for (const h of t.houses) {
    if (h.value === 0 || inR.has(h.id)) continue;
    for (let pos = 0; pos <= route.length; pos++) {
      const prev = pos === 0 ? H : route[pos - 1];
      const next = pos < route.length ? route[pos] : H;
      const add = t.D[prev][h.id] + t.D[h.id][next] - (route.length ? t.D[prev][next] : 0);
      if (len + add > t.curfew) continue;
      const s = h.value / Math.max(add, 0.5);
      if (!best || s > best.s) best = { route: [...route.slice(0, pos), h.id, ...route.slice(pos)], id: h.id, add, s };
    }
  }
  return best;
}

export function planTwoOpt(t: Town): Plan {
  const base = planRatio(t);
  let route = [...base.route];
  const frames: Frame[] = base.frames.slice(0, -1).map((f) => ({ ...f, text: `GREEDY ${f.text}` }));
  frames.push({ route: [...route], at: -1, consider: null, text: `THE GREEDY ROUTE: ${routeHaul(t, route)} CANDY, HOME AT MINUTE ${routeMinutes(t, route)}. NOW UNCROSS IT` });
  for (let guard = 0; guard < 200; guard++) {
    const sw = bestTwoOpt(t, route);
    if (sw) {
      route = sw.route;
      frames.push({ route: [...route], at: -1, consider: sw.touched, text: `2-OPT: WALK A STRETCH BACKWARDS, ${sw.saved} MIN SAVED, HOME AT MINUTE ${routeMinutes(t, route)}` });
      continue;
    }
    const ins = bestInsertion(t, route);
    if (!ins) break;
    route = ins.route;
    frames.push({ route: [...route], at: -1, consider: ins.id, text: `THE SAVED MINUTES BUY ${streetName(t, ins.id)}, ${tname(t, ins.id)}, FOR ${ins.add} MORE MIN` });
  }
  frames.push({ route: [...route], at: -1, consider: null, text: `NO REVERSAL SHORTENS IT AND NO HOUSE FITS: ${routeHaul(t, route)} CANDY, HOME AT MINUTE ${routeMinutes(t, route)}` });
  return finish(t, 'twoopt', route, frames);
}

export function planAnneal(t: Town, iters = 20000): Plan {
  const r = rng((t.seed ^ 0x9e3779b9) >>> 0);
  const pool = t.houses.filter((h) => h.value > 0).map((h) => h.id);
  const score = (rt: number[]) => routeHaul(t, rt) - routeMinutes(t, rt) * 0.001;
  let cur: number[] = [];
  let curS = 0;
  let best: number[] = [];
  let bestS = 0;
  const frames: Frame[] = [{ route: [], at: -1, consider: null, text: 'START FROM AN EMPTY ROUTE, HOT: ALMOST ANY CHANGE IS ACCEPTED' }];
  const T0 = 6;
  for (let k = 0; k < iters; k++) {
    const T = T0 * Math.pow(0.004, k / iters);
    const next = [...cur];
    const out = pool.filter((h) => !cur.includes(h));
    const m = r();
    let touched: number | null = null;
    if ((m < 0.35 || !next.length) && out.length) {
      touched = out[Math.floor(r() * out.length)];
      next.splice(Math.floor(r() * (next.length + 1)), 0, touched);
    } else if (m < 0.5 && next.length) {
      touched = next.splice(Math.floor(r() * next.length), 1)[0];
    } else if (m < 0.7 && next.length && out.length) {
      const i = Math.floor(r() * next.length);
      touched = out[Math.floor(r() * out.length)];
      next[i] = touched;
    } else if (next.length > 1) {
      let i = Math.floor(r() * next.length);
      let j = Math.floor(r() * next.length);
      if (i > j) [i, j] = [j, i];
      const seg = next.slice(i, j + 1).reverse();
      next.splice(i, seg.length, ...seg);
      touched = next[i];
    } else continue;
    if (!feasible(t, next)) continue;
    const s = score(next);
    if (s >= curS || r() < Math.exp((s - curS) / T)) {
      cur = next;
      curS = s;
      if (s > bestS + 1e-9) {
        best = [...cur];
        bestS = s;
        frames.push({ route: [...best], at: -1, consider: touched, text: `TRY ${fmt(k + 1)}, TEMPERATURE ${T.toFixed(2)}: NEW BEST, ${routeHaul(t, best)} CANDY, HOME AT MINUTE ${routeMinutes(t, best)}` });
      }
    }
  }
  let tidy = best;
  for (let g = 0; g < 100; g++) {
    const s = bestTwoOpt(t, tidy);
    if (!s) break;
    tidy = s.route;
  }
  frames.push({ route: [...tidy], at: -1, consider: null, text: `COOLED AFTER ${fmt(iters)} TRIES: ${routeHaul(t, tidy)} CANDY, HOME AT MINUTE ${routeMinutes(t, tidy)}` });
  return finish(t, 'anneal', tidy, frames);
}

/**
 * Node cap for the exact search: past it, it stops and says so. A count, never
 * a clock: the server and the browser must reach the same route from the same
 * seed, or the first paint and the hydrated figure disagree.
 */
export const EXACT_NODE_CAP = 300_000;

/**
 * Exact: depth-first branch and bound over every route home by curfew,
 * starting from the best heuristic route as the score to beat. The bound is
 * a fractional knapsack: each house still in reach costs at least its
 * cheapest way in, and the minutes left cap the total. It stops at
 * `nodeCap` partial routes and says so rather than hang; then its route is
 * the best found, not proved. Deterministic: no wall-clock anywhere.
 */
export function planExact(t: Town, start: number[] = [], nodeCap = EXACT_NODE_CAP): Plan {
  const { D, curfew } = t;
  const H = homeIx(t);
  const cand = t.houses.filter((h) => h.value > 0 && D[H][h.id] + D[h.id][H] <= curfew).map((h) => h.id);
  const val = (h: number) => t.houses[h].value;
  let bestR = feasible(t, start) ? start.slice() : [];
  let bestV = routeHaul(t, bestR);
  let bestLen = routeMinutes(t, bestR);
  const frames: Frame[] = [{ route: bestR.slice(), at: -1, consider: null, text: `TAKE THE BEST HEURISTIC ROUTE, ${bestV} CANDY, AS THE SCORE TO BEAT, THEN SEARCH EVERY ROUTE HOME BY CURFEW` }];
  const used = new Uint8Array(t.houses.length);
  const path: number[] = [];
  let tried = 0;
  let stopped: string | undefined;

  const bound = (at: number, rem: number, v: number): number => {
    const left: number[] = [];
    for (const h of cand) if (!used[h] && D[at][h] + D[h][H] <= rem) left.push(h);
    if (!left.length) return v;
    const items = left.map((h) => {
      let w = D[at][h];
      for (const g of left) if (g !== h && D[g][h] < w) w = D[g][h];
      return { v: val(h), w: Math.max(w, 1) };
    });
    items.sort((p, q) => q.v / q.w - p.v / p.w);
    let cap = rem;
    let ub = v;
    for (const it of items) {
      if (it.w <= cap) {
        cap -= it.w;
        ub += it.v;
      } else {
        ub += (it.v * cap) / it.w;
        break;
      }
    }
    return ub;
  };

  const dfs = (at: number, m: number, v: number) => {
    if (stopped) return;
    if (++tried > nodeCap) {
      stopped = `${fmt(nodeCap)} PARTIAL ROUTES`;
      return;
    }
    const len = m + D[at][H];
    if (v > bestV || (v === bestV && len < bestLen)) {
      bestV = v;
      bestR = path.slice();
      bestLen = len;
      frames.push({ route: bestR.slice(), at: -1, consider: bestR[bestR.length - 1] ?? null, text: `A BETTER ROUTE AFTER ${fmt(tried)} PARTIAL ROUTES: ${bestV} CANDY, HOME AT MINUTE ${len}` });
    }
    if (bound(at, curfew - m, v) <= bestV + 1e-9) return;
    const kids = cand.filter((h) => !used[h] && m + D[at][h] + D[h][H] <= curfew);
    kids.sort((p, q) => val(q) / D[at][q] - val(p) / D[at][p]);
    for (const h of kids) {
      used[h] = 1;
      path.push(h);
      dfs(h, m + D[at][h], v + val(h));
      path.pop();
      used[h] = 0;
      if (stopped) return;
    }
  };
  dfs(H, 0, 0);
  const proved = !stopped;
  frames.push({
    route: bestR.slice(),
    at: -1,
    consider: null,
    text: proved
      ? `SEARCHED ${fmt(tried)} PARTIAL ROUTES AND PROVED IT: NO ROUTE HOME BY CURFEW GETS MORE THAN ${bestV} CANDY`
      : `STOPPED AT ${stopped}: ${bestV} CANDY IS THE BEST FOUND, NOT PROVED`,
  });
  return finish(t, 'exact', bestR, frames, { proved, tried: Math.min(tried, nodeCap), stopped });
}

export function planAll(t: Town): Record<AlgoKey, Plan> {
  const nearest = planNearest(t);
  const ratio = planRatio(t);
  const twoopt = planTwoOpt(t);
  const anneal = planAnneal(t);
  const seed = [nearest, ratio, twoopt, anneal].reduce((a, b) => (b.haul > a.haul || (b.haul === a.haul && b.minutes < a.minutes) ? b : a));
  return { nearest, ratio, twoopt, anneal, exact: planExact(t, seed.route) };
}
