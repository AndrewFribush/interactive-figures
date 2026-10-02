// Trick-or-treat (fig 1.1.15): the neighbourhood generator.
//
// A fresh suburb from a seed. Not a grid: either a curving loop road (with
// an avenue across it, some of the time) or a through-road with a
// crescent, and dead-end courts off both, each ending in a turning bulb
// with houses round it, so a detour into a court is a real trade-off.
// Houses stand beside the streets, set back the same distance, never in
// the road and never on top of each other. Every house hands out one treat.
//
// Distances are shortest walks along the street graph, all pairs, in whole
// minutes; a hop between two different houses costs at least one minute,
// even across the street, and the matrix is closed under the triangle
// inequality after rounding. Pure functions, no React.
//
// The town is laid out on a W by H sheet whose axes are the screen's (p
// across, q down), then turned 45 degrees into ground coordinates at the
// end, so the isometric drawing of it fills a rectangle instead of a
// diamond with empty corners. A rotation keeps every distance, so the
// minutes are the same either way.

export interface Pt {
  x: number;
  y: number;
}

export interface Treat {
  key: string;
  name: string;
  value: number;
  /** Draw weight. */
  p: number;
}

export const TREATS: readonly Treat[] = [
  { key: 'full', name: 'FULL-SIZE BAR', value: 10, p: 0.12 },
  { key: 'fun', name: 'FUN-SIZE', value: 5, p: 0.24 },
  { key: 'lolly', name: 'LOLLIPOP', value: 3, p: 0.26 },
  { key: 'raisins', name: 'RAISINS', value: 1, p: 0.2 },
  { key: 'brush', name: 'TOOTHBRUSH', value: 0, p: 0.18 },
];

export type StreetKind = 'loop' | 'avenue' | 'through' | 'crescent' | 'court';

export interface Street {
  id: number;
  name: string;
  kind: StreetKind;
  /** Vertex indices into `pts`, in order. */
  nodes: number[];
  closed: boolean;
}

export interface House {
  id: number;
  street: number;
  /** Graph node of the doorstep, on the street centreline. */
  door: number;
  doorPt: Pt;
  /** Footprint centre, set back from the street. */
  lot: Pt;
  /** Unit vector along the street at the door (the ridge runs this way). */
  tan: Pt;
  /** Unit vector from the street to the lot. */
  nrm: Pt;
  treat: number;
  value: number;
  /** Stands round a court's turning bulb. */
  bulb: boolean;
}

/** compact: a phone; wide: a stacked board in a ~500-600px column; side: board beside the race. */
export type TownSize = 'compact' | 'wide' | 'side';

export interface Town {
  seed: number;
  size: TownSize;
  W: number;
  H: number;
  /** Street vertices (ground units). */
  pts: Pt[];
  streets: Street[];
  /** Court tips that get a turning bulb. */
  bulbs: { at: Pt; street: number }[];
  houses: House[];
  home: { node: number; at: Pt; lot: Pt; tan: Pt; nrm: Pt; street: number };
  /** Minutes allowed: out and home again. */
  curfew: number;
  /** Whole minutes; indices 0..n-1 are houses, n is home. */
  D: number[][];
  /** Street polyline of the shortest walk between any two of those, ground units. */
  legs: Pt[][][];
}

/** mulberry32: a small seeded generator, so one seed reproduces a town. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Drawn aspect of a W by H sheet is sqrt(3) W / H: about 1.45 (phone), 2.0
// (a stacked board in a column) and 1.6 (beside the race).
export const SPEC: Record<TownSize, { W: number; H: number; houses: number; courts: number }> = {
  compact: { W: 9.8, H: 11.6, houses: 14, courts: 3 },
  wide: { W: 12.6, H: 10.8, houses: 17, courts: 4 },
  side: { W: 13.6, H: 14.4, houses: 22, courts: 5 },
};

/** Minutes per ground unit of street. */
export const MPU = 1.5;
/** House set back from the street centreline. */
export const SETBACK = 0.62;
export const BULB_R = 0.45;
const SLOT = 1.2;
const CLEAR = 2.0;

const TREES = ['MAPLE', 'OAK', 'BIRCH', 'WILLOW', 'CEDAR', 'ELM', 'ASPEN', 'HAWTHORN', 'LINDEN', 'JUNIPER', 'SYCAMORE', 'ALDER', 'POPLAR', 'CHESTNUT', 'LAUREL', 'HAZEL', 'ROWAN', 'SPRUCE'];
const COURT = ['CT', 'CT', 'CL', 'PL', 'CT'];

// ── Geometry ──────────────────────────────────────────────────────────

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const len = (a: Pt) => Math.hypot(a.x, a.y);
const unit = (a: Pt): Pt => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const perp = (a: Pt): Pt => ({ x: -a.y, y: a.x });
const rot = (a: Pt, ang: number): Pt => ({ x: a.x * Math.cos(ang) - a.y * Math.sin(ang), y: a.x * Math.sin(ang) + a.y * Math.cos(ang) });
/**
 * Sheet axes to ground: a 45-degree turn, so ground x - y runs across the
 * drawing and x + y down it. The result is rounded to a millionth: Math.sin,
 * Math.cos and Math.hypot may differ in the last bit between the server's
 * engine and the browser's, and a town drawn from unrounded points would not
 * hydrate onto the server's markup.
 */
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const turn = (a: Pt): Pt => ({ x: r6((a.x + a.y) * Math.SQRT1_2), y: r6((a.y - a.x) * Math.SQRT1_2) });
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function segDist(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y || 1e-12;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2));
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

function streetSegs(s: Street): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < s.nodes.length; k++) out.push([s.nodes[k], s.nodes[k + 1]]);
  if (s.closed) out.push([s.nodes[s.nodes.length - 1], s.nodes[0]]);
  return out;
}

// ── The town ──────────────────────────────────────────────────────────

export function makeTown(seed: number, size: TownSize, opts: { houses?: number } = {}): Town {
  const r = rng(seed);
  const { W, H, courts: nCourts } = SPEC[size];
  const nHouses = opts.houses ?? SPEC[size].houses;
  const pts: Pt[] = [];
  const streets: Street[] = [];
  const names = [...TREES];
  for (let k = names.length - 1; k > 0; k--) {
    const m = Math.floor(r() * (k + 1));
    [names[k], names[m]] = [names[m], names[k]];
  }
  let nameIx = 0;
  const nextName = () => names[nameIx++ % names.length];
  const addPt = (p: Pt) => (pts.push(p), pts.length - 1);

  // Primary roads: a loop most of the time, a through-road otherwise.
  const layout = r() < 0.65 ? 'loop' : 'through';
  let homeNode = -1;
  let homeNrm: Pt = { x: 0.7071, y: 0.7071 };
  if (layout === 'loop') {
    const K = 20;
    const cx = W / 2;
    const cy = H / 2;
    const rx = W * 0.27;
    const ry = H * 0.27;
    const p1 = r() * 6.28;
    const p2 = r() * 6.28;
    const p3 = r() * 6.28;
    const loop: number[] = [];
    for (let i = 0; i < K; i++) {
      const th = (i / K) * Math.PI * 2;
      const k = 1 + 0.09 * Math.sin(th + p1) + 0.07 * Math.sin(2 * th + p2) + 0.04 * Math.sin(3 * th + p3);
      loop.push(addPt({ x: cx + rx * k * Math.cos(th), y: cy + ry * k * Math.sin(th) }));
    }
    const lname = nextName();
    streets.push({ id: 0, name: `${lname} ${['LOOP', 'DRIVE', 'CIRCLE'][Math.floor(r() * 3)]}`, kind: 'loop', nodes: loop, closed: true });
    // Home: the loop vertex nearest the reader (the bottom of the sheet).
    let best = -Infinity;
    for (const v of loop) if (pts[v].y > best) (best = pts[v].y), (homeNode = v);
    homeNrm = unit(sub(pts[homeNode], { x: cx, y: cy }));
    // An avenue across the loop, some of the time, away from home.
    if (r() < 0.55) {
      const hi = loop.indexOf(homeNode);
      const i0 = (hi + 5 + Math.floor(r() * 2)) % K;
      const i1 = (i0 + K / 2) % K;
      const a = pts[loop[i0]];
      const b = pts[loop[i1]];
      const n = perp(unit(sub(b, a)));
      const bend = (r() - 0.5) * 1.2;
      const av = [loop[i0]];
      for (let k = 1; k <= 4; k++) {
        const t = k / 5;
        av.push(addPt(add(add(a, mul(sub(b, a), t)), mul(n, bend * Math.sin(Math.PI * t)))));
      }
      av.push(loop[i1]);
      streets.push({ id: streets.length, name: `${nextName()} ${['AVENUE', 'WAY'][Math.floor(r() * 2)]}`, kind: 'avenue', nodes: av, closed: false });
    }
  } else {
    const K = 13;
    const p = r() * 6.28;
    const amp = 0.7 + r() * 0.6;
    const main: number[] = [];
    for (let i = 0; i < K; i++) {
      const x = 0.5 + ((W - 1) * i) / (K - 1);
      main.push(addPt({ x, y: H * 0.56 + amp * Math.sin((Math.PI * 1.4 * x) / W + p) }));
    }
    streets.push({ id: 0, name: `${nextName()} ${['ROAD', 'STREET', 'AVENUE'][Math.floor(r() * 3)]}`, kind: 'through', nodes: main, closed: false });
    // A crescent off the north side.
    const i1 = 2 + Math.floor(r() * 3);
    const i2 = i1 + 5;
    const a = pts[main[i1]];
    const b = pts[main[i2]];
    const depth = H * (0.27 + r() * 0.06);
    const cr = [main[i1]];
    for (let k = 1; k <= 5; k++) {
      const t = k / 6;
      const base = add(a, mul(sub(b, a), t));
      cr.push(addPt({ x: base.x, y: base.y - depth * Math.sin(Math.PI * t) }));
    }
    cr.push(main[i2]);
    streets.push({ id: 1, name: `${nextName()} CRESCENT`, kind: 'crescent', nodes: cr, closed: false });
    // Home on the main road, south of the crescent's span.
    const hi = i2 + 1 < K - 1 ? Math.min(K - 2, i2 + 1) : Math.max(1, i1 - 1);
    homeNode = main[hi];
    homeNrm = { x: 0, y: 1 };
  }

  const degree = () => {
    const d = new Array(pts.length).fill(0);
    for (const s of streets) for (const [a, b] of streetSegs(s)) (d[a]++, d[b]++);
    return d;
  };
  const allSegs = () => streets.flatMap((s) => streetSegs(s).map(([a, b]) => ({ a, b, s: s.id })));

  // Courts: dead ends off the primary roads, each with a bulb.
  const bulbs: { at: Pt; street: number }[] = [];
  const used = new Set<number>([homeNode]);
  const primary = streets.map((s) => s.id);
  for (let attempt = 0; attempt < 400 && bulbs.length < nCourts; attempt++) {
    const st = streets[primary[Math.floor(r() * primary.length)]];
    const ix = Math.floor(r() * st.nodes.length);
    const v = st.nodes[ix];
    if (!st.closed && (ix < 1 || ix > st.nodes.length - 2)) continue;
    const deg = degree();
    if (deg[v] > 2 || used.has(v)) continue;
    const prev = pts[st.nodes[(ix - 1 + st.nodes.length) % st.nodes.length]];
    const next = pts[st.nodes[(ix + 1) % st.nodes.length]];
    if (dist(pts[v], pts[homeNode]) < 2.4) continue;
    let dir = perp(unit(sub(next, prev)));
    if (r() < 0.5) dir = mul(dir, -1);
    dir = rot(dir, (r() - 0.5) * 0.7);
    const L = size === 'wide' ? 2.4 + r() * 1.0 : 2.1 + r() * 0.7;
    const bend = (r() - 0.5) * 0.9;
    const mid = add(pts[v], mul(dir, L * 0.5));
    const tip = add(mid, mul(rot(dir, bend), L * 0.5));
    const course = [pts[v], mid, tip];
    // Inside the sheet, and clear of every other street.
    const m = 1.2;
    if (tip.x < m || tip.x > W - m || tip.y < m || tip.y > H - m || mid.x < 0.8 || mid.x > W - 0.8 || mid.y < 0.8 || mid.y > H - 0.8) continue;
    let ok = true;
    const segs = allSegs();
    for (let k = 0; k <= 12 && ok; k++) {
      const t = k / 12;
      const p = t < 0.5 ? add(course[0], mul(sub(course[1], course[0]), t * 2)) : add(course[1], mul(sub(course[2], course[1]), (t - 0.5) * 2));
      if (t * L < 0.6) continue;
      // Near its own mouth a court is close to the road it leaves; further out it must clear everything.
      const need = Math.min(k === 12 ? CLEAR + 0.6 : CLEAR, t * L * 0.85);
      for (const sg of segs) if (segDist(p, pts[sg.a], pts[sg.b]) < need) ok = false;
    }
    for (const bl of bulbs) if (dist(bl.at, tip) < 3) ok = false;
    if (!ok) continue;
    const id = streets.length;
    streets.push({ id, name: `${nextName()} ${COURT[Math.floor(r() * COURT.length)]}`, kind: 'court', nodes: [v, addPt(mid), addPt(tip)], closed: false });
    bulbs.push({ at: tip, street: id });
    used.add(v);
    const ii = st.nodes.indexOf(v);
    used.add(st.nodes[(ii + 1) % st.nodes.length]);
    used.add(st.nodes[(ii - 1 + st.nodes.length) % st.nodes.length]);
  }

  // Candidate houses: along every street at a steady pace, both sides, and round each bulb.
  const deg = degree();
  const junctions = pts.map((p, i) => ({ p, i })).filter((q) => deg[q.i] >= 3 || q.i === homeNode);
  const segs = allSegs();
  interface Cand {
    street: number;
    seg: [number, number];
    t: number;
    doorPt: Pt;
    lot: Pt;
    tan: Pt;
    nrm: Pt;
    bulb: boolean;
    tip?: number;
  }
  const cands: Cand[] = [];
  const lotOk = (lot: Pt, own: number) => {
    for (const sg of segs) {
      const d = segDist(lot, pts[sg.a], pts[sg.b]);
      if (d < (sg.s === own ? SETBACK - 0.02 : SETBACK + 0.3)) return false;
    }
    for (const bl of bulbs) if (dist(lot, bl.at) < BULB_R + 0.5 && bl.street !== own) return false;
    return lot.x > 0.3 && lot.x < W - 0.3 && lot.y > 0.3 && lot.y < H - 0.3;
  };
  for (const s of streets) {
    const ss = streetSegs(s);
    const cum = [0];
    for (const [a, b] of ss) cum.push(cum[cum.length - 1] + dist(pts[a], pts[b]));
    const total = cum[cum.length - 1];
    const end = s.kind === 'court' ? total - 1.0 : total - 0.5;
    for (let at = s.kind === 'court' ? 1.1 : 0.6; at < end; at += SLOT) {
      let k = 0;
      while (k < ss.length - 1 && cum[k + 1] < at) k++;
      const [a, b] = ss[k];
      const t = (at - cum[k]) / (cum[k + 1] - cum[k]);
      const doorPt = add(pts[a], mul(sub(pts[b], pts[a]), t));
      if (junctions.some((q) => dist(q.p, doorPt) < (q.i === homeNode ? 1.0 : 0.85))) continue;
      const tan = unit(sub(pts[b], pts[a]));
      for (const side of [1, -1]) {
        const nrm = mul(perp(tan), side);
        const lot = add(doorPt, mul(nrm, SETBACK));
        if (lotOk(lot, s.id)) cands.push({ street: s.id, seg: [a, b], t, doorPt, lot, tan, nrm, bulb: false });
      }
    }
  }
  for (const bl of bulbs) {
    const s = streets[bl.street];
    const tipNode = s.nodes[s.nodes.length - 1];
    const d = unit(sub(pts[tipNode], pts[s.nodes[s.nodes.length - 2]]));
    for (const ang of [-1.4, 0, 1.4]) {
      const nrm = rot(d, ang);
      const lot = add(bl.at, mul(nrm, BULB_R + 0.58));
      if (lotOk(lot, bl.street)) cands.push({ street: bl.street, seg: [tipNode, tipNode], t: 0, doorPt: bl.at, lot, tan: perp(nrm), nrm, bulb: true, tip: tipNode });
    }
  }

  // The home lot, then pick houses: bulbs first (most of them), then the rest at random.
  const homeAt = pts[homeNode];
  const homeStreet = streets.find((s) => s.nodes.includes(homeNode))!.id;
  const homeLot = add(homeAt, mul(homeNrm, SETBACK + 0.1));
  const order = cands.map((_, i) => i);
  for (let k = order.length - 1; k > 0; k--) {
    const m = Math.floor(r() * (k + 1));
    [order[k], order[m]] = [order[m], order[k]];
  }
  const first = cands.map((c) => (c.bulb && r() < 0.85 ? 1 : 0));
  order.sort((p, q) => first[q] - first[p]);
  const chosen: Cand[] = [];
  for (const i of order) {
    if (chosen.length >= nHouses) break;
    const c = cands[i];
    if (dist(c.lot, homeLot) < 1.2) continue;
    if (chosen.some((o) => dist(o.lot, c.lot) < 0.98)) continue;
    chosen.push(c);
  }

  // Treats.
  const pick = () => {
    let u = r();
    for (let t = 0; t < TREATS.length; t++) {
      u -= TREATS[t].p;
      if (u <= 0) return t;
    }
    return TREATS.length - 1;
  };
  const treats = chosen.map(() => pick());
  if (!treats.includes(0)) {
    const bi = chosen.findIndex((c) => c.bulb);
    treats[bi >= 0 ? bi : 0] = 0;
  }

  // The street graph: vertices, plus a doorstep node wherever a house stands mid-segment.
  const nodePts = pts.slice();
  const doorOf = new Map<string, number>();
  const onSeg = new Map<string, { t: number; node: number }[]>();
  const houses: House[] = chosen.map((c, id) => {
    let door: number;
    if (c.bulb) door = c.tip!;
    else {
      const key = `${c.seg[0]}-${c.seg[1]}-${c.t.toFixed(4)}`;
      if (!doorOf.has(key)) {
        nodePts.push(c.doorPt);
        doorOf.set(key, nodePts.length - 1);
        const sk = `${c.seg[0]}-${c.seg[1]}`;
        if (!onSeg.has(sk)) onSeg.set(sk, []);
        onSeg.get(sk)!.push({ t: c.t, node: nodePts.length - 1 });
      }
      door = doorOf.get(key)!;
    }
    return { id, street: c.street, door, doorPt: c.doorPt, lot: c.lot, tan: c.tan, nrm: c.nrm, treat: treats[id], value: TREATS[treats[id]].value, bulb: c.bulb };
  });
  const adj: { to: number; w: number }[][] = nodePts.map(() => []);
  const link = (u: number, v: number) => {
    const w = dist(nodePts[u], nodePts[v]);
    adj[u].push({ to: v, w });
    adj[v].push({ to: u, w });
  };
  for (const sg of segs) {
    const mids = (onSeg.get(`${sg.a}-${sg.b}`) ?? []).slice().sort((p, q) => p.t - q.t);
    const chain = [sg.a, ...mids.map((m) => m.node), sg.b];
    for (let k = 0; k + 1 < chain.length; k++) link(chain[k], chain[k + 1]);
  }

  // All pairs over the houses and home: Dijkstra from each, keeping the path.
  const n = houses.length;
  const srcNode = (i: number) => (i === n ? homeNode : houses[i].door);
  const raw: number[][] = [];
  const legs: Pt[][][] = [];
  for (let i = 0; i <= n; i++) {
    const s = srcNode(i);
    const d = new Array(nodePts.length).fill(Infinity);
    const prev = new Array(nodePts.length).fill(-1);
    const done = new Array(nodePts.length).fill(false);
    d[s] = 0;
    for (;;) {
      let u = -1;
      for (let v = 0; v < nodePts.length; v++) if (!done[v] && d[v] < Infinity && (u < 0 || d[v] < d[u])) u = v;
      if (u < 0) break;
      done[u] = true;
      for (const { to, w } of adj[u])
        if (d[u] + w < d[to] - 1e-12) {
          d[to] = d[u] + w;
          prev[to] = u;
        }
    }
    raw.push(Array.from({ length: n + 1 }, (_, j) => d[srcNode(j)]));
    legs.push(
      Array.from({ length: n + 1 }, (_, j) => {
        const out: Pt[] = [];
        for (let v = srcNode(j); v >= 0; v = prev[v]) out.push(nodePts[v]);
        return out.reverse();
      }),
    );
  }
  // Whole minutes, at least one between two different places, then closed under the triangle inequality.
  const D = raw.map((row, i) => row.map((x, j) => (i === j ? 0 : Math.max(1, Math.round(x * MPU)))));
  for (let k = 0; k <= n; k++) for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) if (D[i][k] + D[k][j] < D[i][j]) D[i][j] = D[i][k] + D[k][j];

  // Curfew: about half of a quick tour of every lit porch, so choosing matters.
  const lit = houses.filter((h) => h.value > 0).map((h) => h.id);
  const tour = quickTour(D, n, lit);
  const curfew = Math.max(20, Math.round((tour * 0.5) / 5) * 5);

  // Turn the sheet into ground coordinates (see the header).
  const tanHome = perp(homeNrm);
  return {
    seed,
    size,
    W,
    H,
    pts: pts.map(turn),
    streets,
    bulbs: bulbs.map((b) => ({ at: turn(b.at), street: b.street })),
    houses: houses.map((h) => ({ ...h, doorPt: turn(h.doorPt), lot: turn(h.lot), tan: turn(h.tan), nrm: turn(h.nrm) })),
    home: { node: homeNode, at: turn(homeAt), lot: turn(homeLot), tan: turn(tanHome), nrm: turn(homeNrm), street: homeStreet },
    curfew,
    D,
    legs: legs.map((row) => row.map((leg) => leg.map(turn))),
  };
}

/** Nearest-neighbour tour from home through `ids` and back, then 2-opt; its length in minutes. */
function quickTour(D: number[][], H: number, ids: number[]): number {
  const left = new Set(ids);
  const route: number[] = [];
  let at = H;
  while (left.size) {
    let best = -1;
    for (const h of left) if (best < 0 || D[at][h] < D[at][best]) best = h;
    route.push(best);
    left.delete(best);
    at = best;
  }
  const L = (rt: number[]) => {
    let t = 0;
    let a = H;
    for (const h of rt) (t += D[a][h]), (a = h);
    return t + D[a][H];
  };
  let cur = route;
  for (let improved = true, g = 0; improved && g < 50; g++) {
    improved = false;
    for (let i = 0; i < cur.length - 1; i++)
      for (let j = i + 1; j < cur.length; j++) {
        const nx = [...cur.slice(0, i), ...cur.slice(i, j + 1).reverse(), ...cur.slice(j + 1)];
        if (L(nx) < L(cur)) (cur = nx), (improved = true);
      }
  }
  return L(cur);
}

export const streetName = (t: Town, h: number) => t.streets[t.houses[h].street].name;
