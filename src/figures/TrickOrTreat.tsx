import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { MONO, INK, SEC, DIM, RULE, LOSS, SHEET } from './figureTokens';
import { FS, CH, LINE, lerp, wrapText, useContainerWidth, useTween, useMix, reducedMotion, crossfade } from './kit';
import { HOUSE_A, HOUSE_B, WALL_HEIGHT, ROOF_HEIGHT, layoutHouses, spreadWalkers } from './TrickOrTreat.layout';
import { TREATS, BULB_R, makeTown, streetName } from './TrickOrTreat.town';
import type { Pt, Town, TownSize } from './TrickOrTreat.town';
import { ALGOS, EXACT_NODE_CAP, arrivals, planAll, routeHaul, routeMinutes } from './TrickOrTreat.algos';
import type { AlgoKey, Plan } from './TrickOrTreat.algos';

// Fig 1.1.15, trick-or-treat routes: a random suburb every round (a curving
// loop or a through-road, with dead-end courts), drawn in isometric line
// work, and all five planners walking it at once. The reader may plan a
// sixth route first by clicking houses; GO races them; a name at the curfew
// line follows that walker and steps its decisions. The finish is each
// walker's haul as a tick on the curfew line, against the best route. Every
// route is home by curfew. Default: a fresh suburb caught mid-race, still.
// The data is generated: TrickOrTreat.town.ts builds the suburb from a seed,
// TrickOrTreat.algos.ts plans the five routes; nothing reads a clock, so the
// server's first paint and the hydrated figure are the same board.

type WKey = AlgoKey | 'you';
const WKEYS: readonly WKey[] = ['nearest', 'ratio', 'twoopt', 'anneal', 'exact', 'you'];
const LABEL: Record<WKey, string> = { ...(Object.fromEntries(ALGOS.map((a) => [a.key, a.label])) as Record<AlgoKey, string>), you: 'YOU' };
const SHORT: Record<WKey, string> = { ...(Object.fromEntries(ALGOS.map((a) => [a.key, a.short])) as Record<AlgoKey, string>), ratio: 'CANDY/MIN', you: 'YOU' };

// The figure's column on / and /fig/N is about 500px at desktop widths.
const SSR_WIDTH = 500;
/** Short planner names below this width. */
const SMALL_BELOW = 480;
const X0 = 4;
// A board where the planners finish apart at every layout size (nearest worst, exact best).
const DEFAULT_SEED = 78;
const S_MAX = 56;
/** Tallest the board may draw, by layout, so the default state fits one screen. */
const BOARD_MAX_H: Record<TownSize, number> = { compact: 188, wide: 222, side: 430 };
const sizeFor = (w: number): TownSize => (w < 440 ? 'compact' : w < 860 ? 'wide' : 'side');
const RACE_SECONDS = 10;
const SQ3 = Math.sqrt(3) / 2;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

// ── Where a walker is at a minute ─────────────────────────────────────────

interface WalkState {
  /** Ground position. */
  p: Pt;
  haul: number;
  /** The house it is walking to, or null on the way home / at home. */
  next: number | null;
  /** Minute it reaches `next`. */
  arrive: number;
}

function polyAt(pts: Pt[], u: number): Pt {
  if (pts.length < 2) return pts[0];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    seg.push(d);
    total += d;
  }
  let want = clamp(u, 0, 1) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const f = seg[i] ? clamp(want / seg[i], 0, 1) : 1;
      return { x: lerp(pts[i].x, pts[i + 1].x, f), y: lerp(pts[i].y, pts[i + 1].y, f) };
    }
    want -= seg[i];
  }
  return pts[pts.length - 1];
}

function walkAt(t: Town, route: readonly number[], m: number): WalkState {
  const H = t.houses.length;
  const seq = [H, ...route, H];
  let clock = 0;
  let haul = 0;
  for (let k = 0; k + 1 < seq.length; k++) {
    const a = seq[k];
    const b = seq[k + 1];
    const d = route.length ? t.D[a][b] : 0;
    if (m < clock + d) {
      const leg = t.legs[a][b];
      return { p: polyAt(leg, (m - clock) / d), haul, next: b === H ? null : b, arrive: clock + d };
    }
    clock += d;
    if (b !== H) haul += t.houses[b].value;
  }
  return { p: t.home.at, haul, next: null, arrive: clock };
}

/** The street polyline of a route (home, stops, home), cut at minute m when given. */
function routePts(t: Town, route: readonly number[], m = Infinity): Pt[] {
  const H = t.houses.length;
  if (!route.length) return [t.home.at];
  const seq = [H, ...route, H];
  const out: Pt[] = [t.home.at];
  let clock = 0;
  for (let k = 0; k + 1 < seq.length; k++) {
    const leg = t.legs[seq[k]][seq[k + 1]];
    const d = t.D[seq[k]][seq[k + 1]];
    if (m < clock + d) {
      const u = (m - clock) / d;
      const total = leg.reduce((s, p, i) => (i ? s + Math.hypot(p.x - leg[i - 1].x, p.y - leg[i - 1].y) : 0), 0);
      let acc = 0;
      for (let i = 1; i < leg.length; i++) {
        const dd = Math.hypot(leg[i].x - leg[i - 1].x, leg[i].y - leg[i - 1].y);
        if (acc + dd >= u * total) break;
        out.push(leg[i]);
        acc += dd;
      }
      out.push(polyAt(leg, u));
      return out;
    }
    for (let i = 1; i < leg.length; i++) out.push(leg[i]);
    clock += d;
  }
  return out;
}

// ── Small drawn controls ───────────────────────────────────────────────────

function ActionLabel({ x, y, text, aria, onClick, off }: { x: number; y: number; text: string; aria: string; onClick: () => void; off?: boolean }) {
  const onKey = (ev: ReactKeyboardEvent<SVGGElement>) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      onClick();
    }
  };
  return (
    <g className={off ? undefined : 'td-act'} role="button" tabIndex={off ? -1 : 0} aria-label={aria} aria-disabled={off || undefined} onClick={off ? undefined : onClick} onKeyDown={off ? undefined : onKey}>
      <rect x={x - 3} y={y - FS - 1} width={text.length * CH + 6} height={LINE + 2} fill="transparent" stroke="none" />
      <text x={x} y={y} fontFamily={MONO} fontSize={FS} fill={off ? DIM : LOSS} letterSpacing="0.02em">
        {text}
      </text>
    </g>
  );
}

/** Distinct shapes keep the candy values readable without oversized glows. */
function Lamp({ x, y, treat, k = 1 }: { x: number; y: number; treat: number; k?: number }) {
  if (treat === 0) return <rect x={x - 3.2 * k} y={y - 3.2 * k} width={6.4 * k} height={6.4 * k} rx={0.5} fill={LOSS} />;
  if (treat === 1) return <circle cx={x} cy={y} r={3 * k} fill={LOSS} />;
  if (treat === 2) return <g>
    <line x1={x} y1={y} x2={x} y2={y + 3.2 * k} stroke={LOSS} strokeWidth={1.2} />
    <circle cx={x} cy={y - 0.5 * k} r={2.5 * k} fill={SHEET} stroke={LOSS} strokeWidth={1.2} />
  </g>;
  if (treat === 3) return <path d={`M${x} ${y - 3 * k}l${3 * k} ${3 * k}l${-3 * k} ${3 * k}l${-3 * k} ${-3 * k}Z`} fill={SHEET} stroke={LOSS} strokeWidth={1} />;
  return <path d={`M${x - 2 * k} ${y - 2 * k}l${4 * k} ${4 * k}m0 ${-4 * k}l${-4 * k} ${4 * k}`} fill="none" stroke={DIM} strokeWidth={1} />;
}

/** The walkers, one costume each, drawn standing on (x, y). */
function Costume({ who, x, y, h, color, opacity = 1, halo = false }: { who: WKey; x: number; y: number; h: number; color: string; opacity?: number; halo?: boolean }) {
  // `halo`: the same outline, fat and in the sheet colour, drawn first so a walker in front cuts cleanly across one behind.
  const sw = halo ? 4 : h > 12 ? 1.3 : 1.1;
  const c = { fill: SHEET, stroke: color, strokeWidth: sw, strokeLinejoin: 'round' as const };
  let body: ReactNode;
  if (who === 'you') {
    const r = h * 0.31;
    const top = y - h;
    body = (
      <>
        <path d={`M${x - r} ${y}V${top + r}A${r} ${r} 0 0 1 ${x + r} ${top + r}V${y}L${x + r / 2} ${y - 2.5}L${x} ${y}L${x - r / 2} ${y - 2.5}Z`} {...c} />
        <circle cx={x - r * 0.38} cy={top + r} r={1.1} fill={color} />
        <circle cx={x + r * 0.38} cy={top + r} r={1.1} fill={color} />
      </>
    );
  } else if (who === 'nearest') {
    const r = h * 0.36;
    const cy = y - r;
    body = (
      <>
        <ellipse cx={x} cy={cy} rx={r * 1.15} ry={r} {...c} />
        <path d={`M${x} ${cy - r}V${cy + r}M${x - r * 0.55} ${cy - r * 0.85}Q${x - r * 0.9} ${cy} ${x - r * 0.55} ${cy + r * 0.85}M${x + r * 0.55} ${cy - r * 0.85}Q${x + r * 0.9} ${cy} ${x + r * 0.55} ${cy + r * 0.85}`} fill="none" stroke={color} strokeWidth={0.8} />
        <line x1={x} y1={cy - r} x2={x + 1.5} y2={cy - r - h * 0.2} stroke={color} strokeWidth={sw} strokeLinecap="round" />
      </>
    );
  } else if (who === 'ratio') {
    const hr = h * 0.2;
    const hy = y - h + hr + h * 0.12;
    body = (
      <>
        <path d={`M${x + h * 0.22} ${y - h * 0.15}Q${x + h * 0.5} ${y - h * 0.3} ${x + h * 0.38} ${y - h * 0.62}`} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" />
        <ellipse cx={x} cy={y - h * 0.26} rx={h * 0.22} ry={h * 0.26} {...c} />
        <path d={`M${x - hr} ${hy - hr * 0.3}L${x - hr * 0.85} ${hy - hr * 1.6}L${x - hr * 0.2} ${hy - hr * 0.95}L${x + hr * 0.2} ${hy - hr * 0.95}L${x + hr * 0.85} ${hy - hr * 1.6}L${x + hr} ${hy - hr * 0.3}A${hr} ${hr} 0 1 1 ${x - hr} ${hy - hr * 0.3}Z`} {...c} />
      </>
    );
  } else if (who === 'twoopt') {
    const hr = h * 0.15;
    const hy = y - h * 0.58;
    body = (
      <>
        <path d={`M${x - h * 0.27} ${y}L${x} ${hy + hr}L${x + h * 0.27} ${y}Z`} {...c} />
        <circle cx={x} cy={hy} r={hr} {...c} />
        <path d={`M${x - h * 0.3} ${hy - hr * 0.6}H${x + h * 0.3}M${x - h * 0.15} ${hy - hr * 0.6}L${x + h * 0.06} ${y - h * 1.08}L${x + h * 0.15} ${hy - hr * 0.6}`} fill={SHEET} stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      </>
    );
  } else if (who === 'anneal') {
    const bw = h * 0.5;
    const headH = h * 0.34;
    const bodyH = h * 0.4;
    const bTop = y - bodyH - 2;
    const hTop = bTop - headH - 1;
    body = (
      <>
        <line x1={x - bw * 0.22} y1={y} x2={x - bw * 0.22} y2={bTop + bodyH} stroke={color} strokeWidth={sw} />
        <line x1={x + bw * 0.22} y1={y} x2={x + bw * 0.22} y2={bTop + bodyH} stroke={color} strokeWidth={sw} />
        <rect x={x - bw / 2} y={bTop} width={bw} height={bodyH} rx={1.2} {...c} />
        <rect x={x - bw * 0.42} y={hTop} width={bw * 0.84} height={headH} rx={1.2} {...c} />
        <line x1={x} y1={hTop} x2={x} y2={hTop - 2.5} stroke={color} strokeWidth={1} />
        <circle cx={x} cy={hTop - 3} r={1} fill={color} />
      </>
    );
  } else {
    // exact: a mummy, wrapped tight.
    const bw = h * 0.42;
    body = (
      <>
        <rect x={x - bw / 2} y={y - h} width={bw} height={h} rx={bw / 2} {...c} />
        <path d={`M${x - bw / 2} ${y - h * 0.45}L${x + bw / 2} ${y - h * 0.58}M${x - bw / 2} ${y - h * 0.22}L${x + bw / 2} ${y - h * 0.32}`} stroke={color} strokeWidth={0.8} />
        <line x1={x - bw / 2 + 0.5} y1={y - h * 0.74} x2={x + bw / 2 - 0.5} y2={y - h * 0.74} stroke={color} strokeWidth={1.6} />
      </>
    );
  }
  return (
    <g pointerEvents="none" opacity={opacity}>
      {body}
    </g>
  );
}

// ── The figure ───────────────────────────────────────────────────────────

type FigureProps = { seed?: number; follow?: WKey; minute?: number };

export default function TrickOrTreat({ seed: seedProp = DEFAULT_SEED, follow = 'ratio', minute }: FigureProps = {}) {
  const [wrapRef, w] = useContainerWidth(SSR_WIDTH);
  const [seed, setSeed] = useState(seedProp);
  const size = sizeFor(w);
  return (
    <div data-trick-or-treat="" style={{ padding: w < 480 ? '0.75rem 0.75rem 1rem' : '1rem 1.25rem 1.25rem' }}>
      {/* Bound the stage's layout width before its CSS zoom is measured. */}
      <style>{`
        .fig-fit-open:has([data-trick-or-treat]) { max-width: calc(100vw - 50px); }
      `}</style>
      <div ref={wrapRef} style={{ width: '100%' }}>
        <TrickOrTreatRound
          key={`${seed}:${size}`}
          seed={seed}
          size={size}
          w={w}
          follow={follow}
          minute={seed === seedProp ? minute : 0}
          onNewTown={() => setSeed((sd) => (sd * 7919 + 104729) % 2147483647)}
        />
      </div>
    </div>
  );
}

// Town-dependent selections never render against a different set of house IDs.
// A layout change starts at the paused demonstration; a new seed starts at home.
function TrickOrTreatRound({ seed, size, w, follow: followProp, minute, onNewTown }: {
  seed: number; size: TownSize; w: number; follow: WKey; minute?: number; onNewTown: () => void;
}) {
  const small = w < SMALL_BELOW;
  const side = size === 'side';
  const town = useMemo(() => makeTown(seed, size), [seed, size]);
  const plans = useMemo(() => planAll(town), [town]);
  const n = town.houses.length;
  const H = n;
  const curfew = town.curfew;

  const [mine, setMine] = useState<number[]>([]);
  const [clockSt, setClock] = useState<number | null>(minute ?? null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [follow, setFollow] = useState<WKey>(followProp);
  const [step, setStep] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [reject, setReject] = useState<number | null>(null);

  const clock = clockSt ?? Math.round(curfew * 0.45);
  const clockRef = useRef(clock);
  clockRef.current = clock;

  // GO: the race the reader started is the only thing that moves.
  useEffect(() => {
    if (!running) return;
    if (reducedMotion()) {
      setClock(curfew);
      setRunning(false);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const rate = curfew / RACE_SECONDS;
    const frame = (now: number) => {
      const next = Math.min(curfew, clockRef.current + ((now - last) / 1000) * rate);
      last = now;
      setClock(next);
      if (next >= curfew) setRunning(false);
      else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, curfew]);

  const walkers: WKey[] = mine.length ? [...WKEYS] : WKEYS.filter((k) => k !== 'you');
  const routeOf = (k: WKey) => (k === 'you' ? mine : plans[k].route);
  const haulOf = (k: WKey) => routeHaul(town, routeOf(k));
  const followK: WKey = follow === 'you' && !mine.length ? 'ratio' : follow;
  const fPlan: Plan | null = followK === 'you' ? null : plans[followK];
  const frames = fPlan?.frames ?? [];
  const stepC = step == null || !frames.length ? null : clamp(step, 0, frames.length - 1);
  const frame = stepC == null ? null : frames[stepC];
  const mix = useMix(WKEYS, followK);
  const exact = plans.exact;

  const go = () => {
    setStep(null);
    setReject(null);
    if (paused && clock < curfew) {
      setPaused(false);
      setRunning(true);
      return;
    }
    setClock(0);
    setPaused(false);
    setRunning(true);
  };
  const pause = () => {
    setRunning(false);
    setPaused(true);
  };
  const choose = (k: WKey) => {
    setFollow(k);
    setStep(null);
  };
  // A click on a house always lands: it stops a running race (your route
  // changed, so the race starts over) and either adds the house, removes it,
  // or says on the sheet why it cannot be added.
  const toggleHouse = (id: number) => {
    setRunning(false);
    setStep(null);
    setPaused(false);
    setClock(0);
    if (mine.includes(id)) {
      setMine(mine.filter((h) => h !== id));
      setReject(null);
      return;
    }
    if (town.houses[id].value === 0 || routeMinutes(town, [...mine, id]) > curfew) {
      setReject(id);
      return;
    }
    setReject(null);
    setMine([...mine, id]);
  };

  // ── Layout: header, then the board, then (beside or under) the race ──────
  const maxW = w - 2 * X0;
  const exactName = exact.proved ? 'EXACT' : 'BEST FOUND';
  const name = (k: WKey) => (k === 'exact' ? exactName : SHORT[k]);
  const fState = walkAt(town, routeOf(followK), clock);
  const done = clock >= curfew - 1e-9;

  const fName = name(followK);
  let title: string;
  if (frame) title = `${fName} · DECISION ${stepC! + 1}/${frames.length}: ${frame.text}`;
  else if (done) title = `${fName}: ${haulOf(followK)} CANDY · ${exact.proved ? 'BEST POSSIBLE' : 'BEST FOUND'} ${exact.haul}`;
  else if (clock <= 0) title = `${n} HOUSES · ${curfew} MINUTES TO GET HOME`;
  else title = `${Math.floor(clock)}/${curfew} MIN · ${fName}: ${fState.haul} CANDY NOW`;
  // Callout: the followed walker's next house in the race, the house in question at a decision, or the house under the pointer.
  let call: { id: number; reference: string; note: string } | null = null;
  const tName = (id: number) => TREATS[town.houses[id].treat].name;
  if (reject != null) {
    const h = town.houses[reject];
    call = {
      id: reject,
      reference: `${streetName(town, reject)} · ${tName(reject)}`,
      note:
        h.value === 0
          ? 'NOT ADDED: NO CANDY HERE'
          : `NOT ADDED: HOME AT ${routeMinutes(town, [...mine, reject])} MIN · CURFEW ${curfew}`,
    };
  } else if (hover != null) {
    const last = mine.length ? mine[mine.length - 1] : H;
    call = {
      id: hover,
      reference: `${streetName(town, hover)} · ${tName(hover)} ${town.houses[hover].value}`,
      // Hover explains the route action for the highlighted house.
      note: mine.includes(hover)
        ? `STOP ${mine.indexOf(hover) + 1} · CLICK TO REMOVE`
        : `${town.D[last][hover]} MIN FROM ${mine.length ? 'LAST STOP' : 'HOME'} · CLICK TO ADD`,
    };
  } else if (frame && frame.consider != null) {
    const at = frame.at < 0 ? H : frame.at;
    const d = town.D[at][frame.consider];
    call = { id: frame.consider, reference: `${streetName(town, frame.consider)} · ${tName(frame.consider)}`, note: `${d} MIN THERE · ${town.D[frame.consider][H]} MIN HOME` };
  } else if (!frame && clock > 0 && !done && fState.next != null) {
    const nx = fState.next;
    call = { id: nx, reference: `${tName(nx)} · ${town.houses[nx].value} CANDY`, note: `ARRIVE AT ${fState.arrive} MIN` };
  }

  const titleRows = wrapText(title, maxW, CH + FS * 0.02);
  let y = 4;
  const titleY = y + FS;
  y = titleY + (titleRows.length - 1) * LINE + 8;

  // The action row.
  const youText = mine.length ? `YOU: ${mine.length} STOPS · HOME ${routeMinutes(town, mine)} MIN` : '';
  const actions: { text: string; aria: string; on: () => void; off?: boolean; plain?: boolean; hint?: boolean }[] = [
    { text: 'NEW NEIGHBOURHOOD', aria: 'Generate a new neighbourhood', on: onNewTown, off: running },
    { text: running ? 'PAUSE' : paused && !done ? 'RESUME >' : 'GO >', aria: running ? 'Pause the race' : 'Race every walker to curfew', on: running ? pause : go },
  ];
  if (mine.length) {
    actions.push({ text: youText, aria: youText, on: () => undefined, plain: true });
    actions.push({ text: 'UNDO', aria: 'Remove your last house', on: () => (setRunning(false), setPaused(false), setMine(mine.slice(0, -1)), setReject(null), setClock(0)) });
    actions.push({ text: 'CLEAR', aria: 'Clear your route', on: () => (setRunning(false), setPaused(false), setMine([]), setReject(null), setClock(0)) });
  }
  if (!mine.length) actions.push({ text: 'PICK HOUSES TO PLAN', aria: '', on: () => undefined, plain: true, hint: true });
  const actPos: { x: number; y: number; it: (typeof actions)[number] }[] = [];
  {
    let ax = X0;
    let ay = y + FS;
    for (const it of actions) {
      const wpx = it.text.length * CH;
      if (ax > X0 && ax + wpx > w - X0) {
        ax = X0;
        ay += LINE + 2;
      }
      actPos.push({ x: ax, y: ay, it });
      ax += wpx + 3 * CH;
    }
    y = ay + 8;
  }

  // The encoding line: each house carries one candy mark.
  const encItems: { treat: number | null; text: string }[] = side
    ? [
        { treat: null, text: 'CANDY AT EACH HOUSE:' },
        { treat: 0, text: 'FULL-SIZE BAR 10' },
        { treat: 1, text: 'FUN-SIZE 5' },
        { treat: 2, text: 'LOLLIPOP 3' },
        { treat: 3, text: 'RAISINS 1' },
        { treat: 4, text: 'OFF: TOOTHBRUSH 0' },
      ]
    : [
        { treat: null, text: 'CANDY:' },
        { treat: 0, text: 'BAR 10' },
        { treat: 1, text: 'FUN 5' },
        { treat: 2, text: 'LOLLY 3' },
        { treat: 3, text: 'RAISIN 1' },
        { treat: 4, text: 'OFF 0' },
      ];
  const encPos: { x: number; y: number; treat: number | null; text: string }[] = [];
  {
    let ex = X0;
    let ey = y + FS;
    for (const it of encItems) {
      const wpx = (it.treat == null ? 0 : 16) + it.text.length * CH;
      if (ex > X0 && ex + wpx > w - X0) {
        ex = X0;
        ey += LINE + 3;
      }
      encPos.push({ x: ex, y: ey, ...it });
      ex += wpx + (side ? 2 : 1.3) * CH;
    }
    y = ey + 6;
  }
  y += side ? 10 : 6;

  // Fit the display placement, including roof clearance, without changing the town.
  const boardRoom = side ? maxW - 520 : maxW;
  const geometry = useMemo(() => {
    let scale = S_MAX;
    let result;
    for (let pass = 0; pass < 8; pass++) {
      const lots = layoutHouses(town, scale);
      const points = [...town.pts, ...lots.houses, lots.home];
      const uMin = Math.min(...points.map((p) => p.x - p.y)) - 0.6;
      const uMax = Math.max(...points.map((p) => p.x - p.y)) + 0.6;
      const vMin = Math.min(...points.map((p) => p.x + p.y)) - 0.6;
      const vMax = Math.max(...points.map((p) => p.x + p.y)) + 0.6;
      const fit = Math.min(S_MAX, boardRoom / ((uMax - uMin) * SQ3), (BOARD_MAX_H[size] - 14) / ((vMax - vMin) * 0.5 + WALL_HEIGHT + ROOF_HEIGHT + 0.05));
      result = { lots, uMin, uMax, vMin, vMax, s: Math.min(scale, fit) };
      if (fit >= scale) break;
      scale = fit * 0.95;
    }
    return result!;
  }, [town, boardRoom, size]);
  const { lots, uMin, uMax, vMin, vMax, s } = geometry;
  const drawLot = (h: { id?: number }) => h.id == null || h.id === H ? lots.home : lots.houses[h.id];
  const cx = s * SQ3;
  const cy = s * 0.5;
  const wallZ = s * WALL_HEIGHT;
  const roofZ = s * ROOF_HEIGHT;
  const boardW = (uMax - uMin) * cx;
  const boardTop = y;
  const headroom = wallZ + roofZ + s * 0.05 + 14;
  const boardH = (vMax - vMin) * cy + headroom;
  const boardLeft = side ? X0 : X0 + (maxW - boardW) / 2;
  const offX = boardLeft - uMin * cx;
  const offY = boardTop + headroom - vMin * cy;
  // Screen points rounded to a hundredth of a pixel, so server and browser
  // write the same attribute even when their trig differs in the last bit.
  const proj = (g: Pt, z = 0): Pt => ({ x: r2(offX + (g.x - g.y) * cx), y: r2(offY + (g.x + g.y) * cy - z) });
  // HOME is lettered under its house, so the board runs down to it.
  const homeLabelY = proj(lots.home).y + FS + (small ? 10 : 14);
  const boardBottom = Math.max(boardTop + boardH, homeLabelY + 4);

  // The race: candy against minutes, curfew at the right, the finish ticks on it.
  const labelW = Math.max(...walkers.map((k) => name(k).length)) * CH + 48;
  const chartX = side ? boardLeft + boardW + 36 : X0 + 28;
  const chartRight = w - X0;
  const plotX0 = chartX;
  const plotX1 = chartRight - labelW - 14;
  const readoutW = side ? boardW : maxW;
  const readoutRows = call ? [
    ...wrapText(call.reference, readoutW, CH).map((text) => ({ text, heading: true })),
    ...wrapText(call.note, readoutW, CH).map((text) => ({ text, heading: false })),
  ] : [];
  const readoutY = boardBottom + LINE;
  const readoutH = Math.max(2, readoutRows.length) * LINE + 12;
  const chartTop = side ? boardTop + 26 : boardBottom + readoutH + 30;
  const plotY0 = chartTop;
  const plotY1 = side ? Math.max(plotY0 + 220, boardBottom - 70) : plotY0 + (size === 'compact' ? 92 : 104);
  const vTop = Math.max(10, Math.ceil((Math.max(...walkers.map(haulOf), exact.haul) * 1.08) / 10) * 10);
  const xOf = (m: number) => plotX0 + (clamp(m, 0, curfew) / curfew) * (plotX1 - plotX0);
  const yOf = (v: number) => plotY1 - (v / vTop) * (plotY1 - plotY0);
  const belowY = plotY1 + FS + 6;
  const stepRowY = belowY + LINE + 10;
  const cap = EXACT_NODE_CAP.toLocaleString('en-US');
  const tried = (exact.tried ?? 0).toLocaleString('en-US');
  const exactNote = exact.proved
    ? `BEST POSSIBLE: ${exact.haul} CANDY · ${tried} ROUTES CHECKED`
    : `BEST FOUND: ${exact.haul} CANDY · CAP ${cap}, NOT PROVED`;
  const noteW = chartRight - X0 - (side ? chartX - X0 : 0);
  const noteRows = wrapText(exactNote, noteW, CH);
  const noteY = stepRowY + LINE + 8;
  const sheetH = Math.max(boardBottom + readoutH + 6, noteY + (noteRows.length - 1) * LINE + 10);

  // ── The followed walker's state for the board ─────────────────────────
  // Stepping a decision moves the walker to where it stood; the change tweens.
  const stepKey = `${seed}|${followK}|${stepC ?? 'race'}`;
  const tw = useTween(1, { key: stepKey });
  const e = tw.active ? tw.e : 1;

  // How much a ground direction faces the reader (the bottom of the sheet).
  const view = (v: Pt) => (v.x + v.y) * Math.SQRT1_2;
  // The mark sits on a visible wall of its own house, never on a detached post.
  const lampPt = (id: number): Pt => {
    const h = town.houses[id];
    const lot = drawLot(h);
    const faces = [
      { v: h.nrm, d: HOUSE_B }, { v: { x: -h.nrm.x, y: -h.nrm.y }, d: HOUSE_B },
      { v: h.tan, d: HOUSE_A }, { v: { x: -h.tan.x, y: -h.tan.y }, d: HOUSE_A },
    ];
    const face = faces.sort((a, b) => view(b.v) - view(a.v))[0];
    return proj({ x: lot.x + face.v.x * face.d, y: lot.y + face.v.y * face.d }, wallZ * 0.45);
  };
  const pathD = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');
  const gPath = (pts: Pt[]) => pathD(pts.map((p) => proj(p)));

  // A box with a gable roof. The ridge runs along whichever house axis
  // points more toward the reader, so a gable end (the pentagon that says
  // "house") is always on show; a ridge seen side-on would leave a plain box.
  const houseShape = (lot: Pt, tan: Pt, nrm: Pt, key: string, home = false, selected = false) => {
    const a = HOUSE_A * (home ? 1.15 : 1);
    const b = HOUSE_B * (home ? 1.15 : 1);
    const hz = wallZ * (home ? 1.1 : 1);
    const P = (su: number, sv: number, z: number) => proj({ x: lot.x + tan.x * a * su + nrm.x * b * sv, y: lot.y + tan.y * a * su + nrm.y * b * sv }, z);
    const alongTan = Math.abs(view(tan)) >= Math.abs(view(nrm));
    // Ridge ends: at su = ±1 (ridge along tan) or sv = ±1 (along nrm).
    const R = (k: number) => (alongTan ? proj({ x: lot.x + tan.x * a * k, y: lot.y + tan.y * a * k }, hz + roofZ) : proj({ x: lot.x + nrm.x * b * k, y: lot.y + nrm.y * b * k }, hz + roofZ));
    const toward = (v: Pt) => view(v) > 1e-6;
    const pts = (arr: Pt[]) => arr.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const common = { fill: SHEET, stroke: selected ? LOSS : INK, strokeWidth: selected ? 1.5 : 0.9, strokeLinejoin: 'round' as const };
    const faces: ReactNode[] = [];
    if (alongTan) {
      const front = toward(nrm) ? 1 : -1;
      faces.push(<polygon key="rb" points={pts([P(-1, -front, hz), P(1, -front, hz), R(1), R(-1)])} {...common} />);
      for (const sv of [1, -1]) if (toward({ x: nrm.x * sv, y: nrm.y * sv })) faces.push(<polygon key={`w${sv}`} points={pts([P(-1, sv, 0), P(1, sv, 0), P(1, sv, hz), P(-1, sv, hz)])} {...common} />);
      for (const su of [1, -1]) if (toward({ x: tan.x * su, y: tan.y * su })) faces.push(<polygon key={`e${su}`} points={pts([P(su, -1, 0), P(su, 1, 0), P(su, 1, hz), R(su), P(su, -1, hz)])} {...common} />);
      faces.push(<polygon key="rf" points={pts([P(-1, front, hz), P(1, front, hz), R(1), R(-1)])} {...common} />);
    } else {
      const front = toward(tan) ? 1 : -1;
      faces.push(<polygon key="rb" points={pts([P(-front, -1, hz), P(-front, 1, hz), R(1), R(-1)])} {...common} />);
      for (const su of [1, -1]) if (toward({ x: tan.x * su, y: tan.y * su })) faces.push(<polygon key={`w${su}`} points={pts([P(su, -1, 0), P(su, 1, 0), P(su, 1, hz), P(su, -1, hz)])} {...common} />);
      for (const sv of [1, -1]) if (toward({ x: nrm.x * sv, y: nrm.y * sv })) faces.push(<polygon key={`e${sv}`} points={pts([P(-1, sv, 0), P(1, sv, 0), P(1, sv, hz), R(sv), P(-1, sv, hz)])} {...common} />);
      faces.push(<polygon key="rf" points={pts([P(front, -1, hz), P(front, 1, hz), R(1), R(-1)])} {...common} />);
    }
    // The door, on the street side, when that wall faces the reader.
    if (toward({ x: -nrm.x, y: -nrm.y })) faces.push(<polygon key="d" points={pts([P(-0.2, -1, 0), P(0.2, -1, 0), P(0.2, -1, hz * 0.6), P(-0.2, -1, hz * 0.6)])} fill="none" stroke={INK} strokeWidth={0.8} />);
    return <g key={key}>{faces}</g>;
  };

  // Walker positions: the followed one may be at a stepped decision; the rest are at the race clock.
  const posOf = (k: WKey): Pt => {
    if (k === followK && frame) {
      const at = frame.at < 0 ? town.home.at : town.houses[frame.at].doorPt;
      return at;
    }
    return walkAt(town, routeOf(k), clock).p;
  };
  const fTo = posOf(followK);
  const fromKey = typeof tw.fromKey === 'string' ? tw.fromKey : stepKey;
  const fFrom = useMemo(() => {
    const [ps, pf, pst] = fromKey.split('|');
    if (Number(ps) !== seed || pf !== followK || pst === 'race') return fTo;
    const fr = frames[Number(pst)];
    return fr ? (fr.at < 0 ? town.home.at : town.houses[fr.at].doorPt) : fTo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromKey, seed, followK, town]);
  const followPos = frame && e < 1 ? { x: lerp(fFrom.x, fTo.x, e), y: lerp(fFrom.y, fTo.y, e) } : fTo;

  const scaleK = small ? 0.82 : 1;
  const walkerH = clamp(s * 0.42, 11, 14);
  const followH = walkerH;

  // Keep nearby walkers distinct without pushing a reversed pair together.
  const walkerSpot = (() => {
    const raw = walkers.map((k) => proj(k === followK ? followPos : posOf(k)));
    const spaced = spreadWalkers(raw, walkerH * 1.1);
    return new Map(walkers.map((k, i) => [k, { x: r2(spaced[i].x), y: spaced[i].y }]));
  })();
  // Finish labels on the curfew line, pushed apart so they never overlap.
  const finish = walkers
    .map((k) => ({ k, v: haulOf(k) }))
    .sort((p, q) => q.v - p.v || WKEYS.indexOf(p.k) - WKEYS.indexOf(q.k));
  {
    let lastY = -Infinity;
    for (const f of finish) {
      const want = yOf(f.v) + 4;
      (f as typeof f & { ly: number }).ly = Math.max(want, lastY + LINE + 2);
      lastY = (f as typeof f & { ly: number }).ly;
    }
    // The last name stays clear of the "click a name" line under the column.
    const over = lastY - (plotY1 - 2);
    if (over > 0) for (const f of finish) (f as typeof f & { ly: number }).ly -= over;
  }
  const finishL = finish as (typeof finish[number] & { ly: number })[];

  const stepLine = (k: WKey, upTo: number) => {
    const route = routeOf(k);
    const arr = arrivals(town, route).stops;
    const out: [number, number][] = [[0, 0]];
    let v = 0;
    for (let i = 0; i < route.length; i++) {
      if (arr[i] > upTo) break;
      out.push([arr[i], v]);
      v += town.houses[route[i]].value;
      out.push([arr[i], v]);
    }
    out.push([Math.min(upTo, curfew), v]);
    return out.map(([m, vv], i) => `${i ? 'L' : 'M'}${xOf(m).toFixed(1)} ${yOf(vv).toFixed(1)}`).join('');
  };
  const raceClock = frame ? curfew : clock;

  const myStop = new Map(mine.map((h, i) => [h, i + 1]));
  const houseOrder = useMemo(() => [...lots.houses.map((p, id) => ({ id, d: p.x + p.y })), { id: H, d: lots.home.x + lots.home.y }].sort((p, q) => p.d - q.d), [lots, H]);

  // Street drawing: curbs in grey, the road in sheet.
  const streetD = town.streets.map((st) => gPath([...st.nodes.map((i) => town.pts[i]), ...(st.closed ? [town.pts[st.nodes[0]]] : [])])).join('');
  const sw = Math.max(6, s * 0.36);
  const bulbRx = BULB_R * Math.SQRT2 * cx;
  const bulbRy = BULB_R * Math.SQRT2 * cy;

  const ariaTitle = title;

  return (
    <>
        <svg viewBox={`0 0 ${w} ${sheetH}`} width="100%" height={sheetH} style={{ display: 'block' }} role="group" aria-label={ariaTitle}>
          <style>{`
            .td-act { cursor: pointer; }
            .td-act:hover text { text-decoration: underline; }
            .td-act:focus { outline: none; }
            .td-act:focus-visible rect { stroke: ${INK}; stroke-width: 1; }
            .td-house { cursor: pointer; }
            .td-house:focus { outline: none; }
            .td-house:focus-visible circle { stroke: ${INK}; stroke-width: 1; }
          `}</style>

          {titleRows.map((row, i) => (
            <text key={i} x={X0} y={titleY + i * LINE} fontFamily={MONO} fontSize={FS} fill={INK} fontWeight={700} letterSpacing="0.02em">
              {row}
            </text>
          ))}
          {actPos.map(({ x, y: ay, it }, i) => (
            <g key={it.text}>
              {i > 0 && x > X0 + 1 && (
                <text x={x - 1.5 * CH} y={ay} fontFamily={MONO} fontSize={FS} fill={DIM} textAnchor="middle">
                  ·
                </text>
              )}
              {it.plain ? (
                <text x={x} y={ay} fontFamily={MONO} fontSize={FS} fill={it.hint ? DIM : INK}>
                  {it.text}
                </text>
              ) : (
                <ActionLabel x={x} y={ay} text={it.text} aria={it.aria} onClick={it.on} off={it.off} />
              )}
            </g>
          ))}
          {encPos.map((it) => (
            <g key={it.text}>
              {it.treat != null && <Lamp x={it.x + 6} y={it.y - 4} treat={it.treat} k={it.treat === 0 ? 0.62 : 0.9} />}
              <text x={it.x + (it.treat == null ? 0 : 16)} y={it.y} fontFamily={MONO} fontSize={FS} fill={SEC}>
                {it.text}
              </text>
            </g>
          ))}

          {/* ── The board ── */}
          <rect data-plot="" x={boardLeft} y={boardTop} width={boardW} height={boardH} fill="none" stroke="none" pointerEvents="none" />
          <g>
            <path d={streetD} stroke={RULE} strokeWidth={sw + 2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            {town.bulbs.map((b, i) => {
              const p = proj(b.at);
              return <ellipse key={i} cx={p.x} cy={p.y} rx={bulbRx + 1} ry={bulbRy + 1} fill={RULE} />;
            })}
            <path d={streetD} stroke={SHEET} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            {town.bulbs.map((b, i) => {
              const p = proj(b.at);
              return <ellipse key={i} cx={p.x} cy={p.y} rx={bulbRx - 0.5} ry={bulbRy - 0.5} fill={SHEET} />;
            })}
          </g>

          {/* Routes: every walker's walked part in grey; the followed one in the accent, the rest of its plan dashed. */}
          {walkers.map((k) => {
            if (k === followK) return null;
            const d = gPath(routePts(town, routeOf(k), raceClock));
            const g = 1 - mix.value[k];
            return <path key={k} d={d} fill="none" stroke={k === 'you' ? INK : DIM} strokeWidth={k === 'you' ? 1.6 : 1.1} opacity={(k === 'you' ? 0.9 : 0.55) * g} strokeLinejoin="round" />;
          })}
          {mine.length > 0 && followK !== 'you' && clock <= 0 && <path d={gPath(routePts(town, mine))} fill="none" stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />}
          {frame ? (
            <path d={gPath(routePts(town, frame.route))} fill="none" stroke={LOSS} strokeWidth={1.8} strokeDasharray="5 3" strokeLinejoin="round" opacity={mix.value[followK]} />
          ) : (
            <g opacity={mix.value[followK]}>
              <path d={gPath(routePts(town, routeOf(followK)))} fill="none" stroke={LOSS} strokeWidth={1.3} strokeDasharray="2 3" strokeLinejoin="round" opacity={0.75} />
              <path d={gPath(routePts(town, routeOf(followK), clock))} fill="none" stroke={LOSS} strokeWidth={2.2} strokeLinejoin="round" />
            </g>
          )}

          {/* Driveways connect each candy mark to its own stop on the street. */}
          {[...town.houses, { ...town.home, id: H, doorPt: town.home.at }].map((h) => {
            const at = proj(h.doorPt);
            const to = proj(drawLot(h));
            const length = Math.hypot(to.x - at.x, to.y - at.y) || 1;
            const dx = (to.x - at.x) / length;
            const dy = (to.y - at.y) / length;
            const edge = 'bulb' in h && h.bulb ? 1 / Math.hypot(dx / bulbRx, dy / bulbRy) : sw / 2;
            return <line key={`drive-${h.id}`} x1={at.x + dx * edge} y1={at.y + dy * edge} x2={to.x} y2={to.y} stroke={RULE} strokeWidth={0.8} pointerEvents="none" />;
          })}
          {/* Each house and its candy mark are painted together, back to front. */}
          {houseOrder.map(({ id }) => {
            if (id === H) return houseShape(lots.home, town.home.tan, town.home.nrm, 'home', true);
            const h = town.houses[id];
            const p = lampPt(id);
            return <g key={id} data-house={id}>
              {houseShape(drawLot(h), h.tan, h.nrm, `h${id}`, false, call?.id === id)}
              <Lamp x={p.x} y={p.y} treat={h.treat} k={scaleK} />
            </g>;
          })}
          {(() => {
            const p = proj(lots.home);
            return (
              <text x={p.x} y={homeLabelY} fontFamily={MONO} fontSize={FS} fontWeight={700} fill={INK} textAnchor="middle" stroke={SHEET} strokeWidth={3} paintOrder="stroke">
                HOME
              </text>
            );
          })()}
          {mine.map((h, i) => {
            const p = lampPt(h);
            return (
              <text key={`m${h}`} x={p.x - 8} y={p.y - 6} fontFamily={MONO} fontSize={FS} fontWeight={700} fill={INK} textAnchor="end" stroke={SHEET} strokeWidth={3} paintOrder="stroke">
                {i + 1}
              </text>
            );
          })}
          {/* Walkers: grey, the followed one in the accent, centered on the street and drawn last. */}
          {[...walkers.filter((k) => k !== followK), followK].map((k) => {
            const p = walkerSpot.get(k) ?? { x: 0, y: 0 };
            const on = mix.value[k];
            const hh = lerp(walkerH, followH, on);
            // Walkers never take a click: a house under one must still be clickable.
            return (
              <g key={k} pointerEvents="none">
                {on > 0.01 && <ellipse cx={p.x} cy={p.y} rx={hh * 0.62} ry={hh * 0.62} fill={LOSS} opacity={0.22 * on} />}
                {crossfade(on, k === 'you' ? INK : SEC, LOSS).map((l) => (
                  <g key={l.on ? 'on' : 'off'}>
                    <Costume who={k} x={p.x} y={p.y + hh / 2} h={hh} color={SHEET} opacity={l.opacity} halo />
                    <Costume who={k} x={p.x} y={p.y + hh / 2} h={hh} color={l.color} opacity={l.opacity} />
                  </g>
                ))}

              </g>
            );
          })}

          {/* Hit targets on the houses: click in order to plan your own route. Each
              reaches at most halfway to the next candy mark, so targets never
              overlap and a click always lands on the house under the pointer. */}
          {town.houses.map((h) => {
            const p = lampPt(h.id);
            const hitR = r2(Math.max(5, Math.min(Math.max(12, s * 0.45), ...town.houses.filter((o) => o.id !== h.id).map((o) => Math.hypot(lampPt(o.id).x - p.x, lampPt(o.id).y - p.y) / 2))));
            const tr = TREATS[h.treat];
            return (
              <g
                key={`hit${h.id}`}
                className="td-house"
                role="button"
                tabIndex={0}
                aria-label={`${streetName(town, h.id).toLowerCase()}, ${tr.name.toLowerCase()}, ${tr.value} candy. ${myStop.has(h.id) ? `Your stop ${myStop.get(h.id)}; press to remove` : 'Press to add to your route'}`}
                onClick={() => toggleHouse(h.id)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    toggleHouse(h.id);
                  }
                }}
                onPointerEnter={(ev) => ev.pointerType === 'mouse' && setHover(h.id)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(h.id)}
                onBlur={() => setHover(null)}
              >
                <circle cx={p.x} cy={p.y} r={hitR} fill="transparent" stroke="none" />
              </g>
            );
          })}

          <g data-map-readout="" pointerEvents="none">
            {readoutRows.map((row, i) => <text key={i} x={X0} y={readoutY + i * LINE} fontFamily={MONO} fontSize={FS} fill={row.heading ? INK : DIM} fontWeight={row.heading ? 700 : undefined}>{row.text}</text>)}
          </g>

          {/* ── The race ── */}
          <rect data-plot="" x={plotX0} y={plotY0} width={chartRight - plotX0} height={plotY1 - plotY0} fill="none" stroke="none" pointerEvents="none" />
          <text x={plotX0} y={plotY0 - 12} fontFamily={MONO} fontSize={FS} fill={DIM}>
            {frame ? 'FINAL CANDY' : 'CANDY'}
          </text>
          {[0, vTop / 2, vTop].map((v) => (
            <g key={v}>
              <line x1={plotX0} x2={plotX1} y1={yOf(v)} y2={yOf(v)} stroke={RULE} strokeWidth={v === 0 ? 1 : 0.6} opacity={v === 0 ? 1 : 0.6} />
              <text x={plotX0 - 6} y={yOf(v) + 4} fontFamily={MONO} fontSize={FS} fill={DIM} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          <text x={plotX0} y={belowY} fontFamily={MONO} fontSize={FS} fill={DIM}>
            0
          </text>
          <text x={plotX1 + 14} y={belowY} fontFamily={MONO} fontSize={FS} fill={DIM}>
            {`${small ? 'TAP' : 'CLICK'} A NAME`}
          </text>
          {/* The curfew line, with nothing written across it. */}
          <line x1={plotX1} x2={plotX1} y1={plotY0 - 4} y2={plotY1} stroke={INK} strokeWidth={1.2} />
          <text x={plotX1 + 14} y={plotY0 - 12} fontFamily={MONO} fontSize={FS} fill={INK}>
            FINAL HAUL
          </text>
          <text x={plotX1} y={belowY} textAnchor="end" fontFamily={MONO} fontSize={FS} fill={DIM}>
            {`${curfew} MIN`}
          </text>
          {raceClock > 0 && raceClock < curfew && (
            <g>
              <line x1={xOf(raceClock)} x2={xOf(raceClock)} y1={plotY0} y2={plotY1} stroke={INK} strokeWidth={0.8} strokeDasharray="2 3" />
            </g>
          )}
          {walkers.map((k) => {
            if (k === followK) return null;
            return <path key={k} d={stepLine(k, raceClock)} fill="none" stroke={k === 'you' ? INK : DIM} strokeWidth={1.1} opacity={0.7 * (1 - mix.value[k])} strokeLinejoin="round" />;
          })}
          <path d={stepLine(followK, curfew)} fill="none" stroke={LOSS} strokeWidth={1.1} strokeDasharray="2 3" opacity={0.7} />
          <path d={stepLine(followK, raceClock)} fill="none" stroke={LOSS} strokeWidth={2.2} strokeLinejoin="round" />

          {/* The finish: each walker's haul as a tick on the curfew line, its name and running total beside it. */}
          {finishL.map((f) => {
            const on = mix.value[f.k];
            const ty = yOf(f.v);
            const lx = plotX1 + 14;
            const label = name(f.k);
            const live = f.k !== followK;
            const act = () => choose(f.k);
            return (
              <g
                key={f.k}
                className={live ? 'td-act' : undefined}
                role={live ? 'button' : undefined}
                tabIndex={live ? 0 : undefined}
                aria-label={`${live ? 'Follow ' : ''}${LABEL[f.k].toLowerCase()}, ${f.v} candy by curfew`}
                aria-current={live ? undefined : true}
                onClick={live ? act : undefined}
                onKeyDown={
                  live
                    ? (ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          act();
                        }
                      }
                    : undefined
                }
              >
                <line x1={plotX1 - 5} x2={plotX1 + 5} y1={ty} y2={ty} stroke={on > 0.5 ? LOSS : INK} strokeWidth={on > 0.5 ? 2 : 1.2} />
                {Math.abs(f.ly - 4 - ty) > 2 && <line x1={plotX1 + 5} x2={lx - 2} y1={ty} y2={f.ly - 4} stroke={RULE} strokeWidth={0.8} />}
                <rect x={lx - 2} y={f.ly - FS - 1} width={labelW} height={LINE + 2} fill="transparent" stroke="none" />
                {crossfade(on, f.k === 'you' ? INK : DIM, LOSS).map((l) => (
                  <g key={l.on ? 'on' : 'off'} opacity={l.opacity}>
                    <Costume who={f.k} x={lx + 5} y={f.ly + 1} h={12} color={l.color} />
                    <text x={lx + 14} y={f.ly} fontFamily={MONO} fontSize={FS} fill={l.color} fontWeight={l.on ? 700 : undefined}>
                      {label}
                    </text>
                    <text x={chartRight} y={f.ly} textAnchor="end" fontFamily={MONO} fontSize={FS} fill={l.color} fontWeight={l.on ? 700 : undefined}>
                      {f.v}
                    </text>
                  </g>
                ))}
              </g>
            );
          })}

          {/* Step through the followed walker's decisions. */}
          {fPlan &&
            (() => {
              const items = [
                { text: '‹ BACK', aria: 'Previous decision', on: () => setStep(Math.max(0, (stepC ?? 1) - 1)), off: stepC === 0 || running },
                { text: stepC == null ? `STEP THROUGH ${name(followK)} ›` : 'NEXT ›', aria: 'Next decision', on: () => (setRunning(false), setStep(stepC == null ? 0 : Math.min(frames.length - 1, stepC + 1))), off: running || (stepC != null && stepC >= frames.length - 1) },
                ...(stepC != null ? [{ text: 'RACE', aria: 'Back to the race', on: () => setStep(null), off: false }] : []),
              ].filter((it) => stepC != null || it.text !== '‹ BACK');
              let x = side ? chartX - 28 : X0;
              return items.map((it, i) => {
                const at = x;
                x += it.text.length * CH + 3 * CH;
                return (
                  <g key={it.text}>
                    {i > 0 && (
                      <text x={at - 1.5 * CH} y={stepRowY} fontFamily={MONO} fontSize={FS} fill={DIM} textAnchor="middle">
                        ·
                      </text>
                    )}
                    <ActionLabel x={at} y={stepRowY} text={it.text} aria={it.aria} onClick={it.on} off={it.off} />
                  </g>
                );
              });
            })()}
          {noteRows.map((row, i) => (
            <text key={i} x={side ? chartX - 28 : X0} y={noteY + i * LINE} fontFamily={MONO} fontSize={FS} fill={DIM}>
              {row}
            </text>
          ))}
        </svg>
      <p className="sr-only" aria-live="polite">
        {reject != null && call ? `${call.reference}: ${call.note}` : title}
      </p>
    </>
  );
}
