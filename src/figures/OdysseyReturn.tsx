import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { MEDITERRANEAN } from './map-data/mediterranean';
import { HIGHLIGHT_CHANNELS, subscribeHighlight } from './highlight';

// Fig 1.1.2 · Minard's method applied to the Odyssey: a band whose width is
// men remaining, flowing Troy → Ithaca over a real chart of the central
// Mediterranean (Natural Earth 10m coastline; traditional identifications:
// Djerba, Sicily, Messina, Gozo, Corfu). Press play and the return draws
// itself in story time · legs run at
// the pace they were sailed, and the band waits where Odysseus waited. The
// band steps down at a right angle at every loss. The numbers are Homer's
// (12 ships of fifty from the Catalogue; six per ship at Ismarus; one man
// home), kept consistent ship by ship so the muster roll above the chart
// never resurrects anyone.

import { figParamKey, useFigUrlState } from './useFigUrlState';

const BAND = '#0f8040';
const LOSS = '#b3501d';
const LAND = '#f0f1ec';
const COAST = 'rgba(16, 20, 24, 0.3)';

// Animation clock: legs run on DISTANCE · the band draws at a constant chart
// speed, so a long haul takes visibly longer than a short hop · while stays
// run on story time (seconds per voyage-year). A floor keeps quick hops
// perceivable. Calypso is most of the runtime · that is the point.
const RATE = 1.3;
const LEG_MIN = 0.35;
const PX_PER_SEC = 170;

// Equirectangular chart: lon 8–28.5°E → x 30–700, lat 31.5–42.5°N → y 370–20.
const X = (lon: number) => 30 + (lon - 8) * 32.7;
const Y = (lat: number) => 370 - (lat - 31.5) * 31.8;
// Real coastline: Natural Earth 10m geometry compiled into the repo by
// scripts/build-map-data.mjs, already clipped to this chart's bbox, drawn
// through the same transform as every stop so the geography is honest ·
// Cape Malea, the Bonifacio strait, Djerba, and the Ionian islands are the
// actual places the bands touch.
const LAND_D = MEDITERRANEAN.rings
  .map(
    (ring) =>
      'M' +
      ring.map(([lon, lat]) => `${X(lon).toFixed(1)},${Y(lat).toFixed(1)}`).join('L') +
      'Z'
  )
  .join('');

interface Stop {
  x: number;
  y: number;
  /** Men remaining after this stop's event. */
  men: number;
  ships: number;
  /** Voyage years at arrival · the animation clock runs on these. */
  years: number;
  /** Color of the leg ARRIVING at this stop (waypoints inherit their journey's). */
  c: string;
  /** Color of the stay period spent here, if any. */
  stayC?: string;
  name?: string;
  loss?: string;
  ref?: string;
  lx?: number;
  ly?: number;
  anchor?: 'start' | 'middle' | 'end';
  /** Leader line start, for labels that stand away from their dot. */
  ll?: [number, number];
  /** [yearsAtDeparture] · time spent here becomes a real pause. */
  stay?: number;
  /** Course waypoint · no dot, no label. */
  silent?: boolean;
  /** Open-circle marker (a sighting, not a landing). */
  open?: boolean;
}

const S = (lon: number, lat: number) => ({ x: Math.round(X(lon)), y: Math.round(Y(lat)) });

const STOPS: Stop[] = [
  { ...S(26.2, 39.95), men: 600, ships: 12, years: 0,
    c: '#0f8040', name: 'TROY · 600 MEN', lx: 712, ly: 128, anchor: 'end' },
  { ...S(25.4, 40.85), men: 528, ships: 12, years: 0.05,
    c: '#0f8040', name: 'CICONES', loss: '−72', ref: 'BK 9', lx: 588, ly: 60, anchor: 'end' },
  { ...S(24.35, 37.5), men: 528, ships: 12, years: 0.07, c: '#3466c2', silent: true },
  { ...S(23.2, 36.42), men: 528, ships: 12, years: 0.08,
    c: '#3466c2', name: 'MALEA · BLOWN SOUTH', lx: 712, ly: 233, anchor: 'end' },
  { ...S(10.85, 33.9), men: 528, ships: 12, years: 0.3,
    c: '#b0439a', name: 'LOTUS-EATERS', ref: 'BK 9', lx: 136, ly: 312, anchor: 'start' },
  { ...S(15.15, 37.6), men: 522, ships: 12, years: 0.5,
    c: '#7b5cc4', name: 'CYCLOPS', loss: '−6', lx: 170, ly: 170, anchor: 'start', ll: [246, 175] },
  { ...S(14.95, 38.55), men: 522, ships: 12, years: 0.65,
    c: '#0f8a8a', name: 'AEOLIA · BAG OF WINDS', ref: 'BK 10', lx: 31, ly: 186, anchor: 'start', ll: [241, 180] },
  { x: 285, y: 163, men: 522, ships: 12, years: 0.7, c: '#b8860b', silent: true },
  { ...S(20.2, 38.35), men: 522, ships: 12, years: 0.78,
    c: '#b8860b', name: 'ITHACA IN SIGHT · BLOWN BACK', lx: 370, ly: 214, anchor: 'middle', open: true },
  { x: 350, y: 178, men: 522, ships: 12, years: 0.83, c: '#64748b', silent: true },
  { ...S(14.95, 38.55), men: 522, ships: 12, years: 0.88, c: '#64748b', silent: true },
  // Six days of rowing up the Tyrrhenian: the course to the Laestrygonians
  // bows north so the red leg visibly TURNS at Aeolia · without the bend it
  // ran collinear with the slate return and read as one band changing color.
  { ...S(13.3, 40.5), men: 522, ships: 12, years: 0.94, c: '#c43d3d', silent: true },
  { ...S(9.2, 41.4), men: 38, ships: 1, years: 1.0,
    c: '#c43d3d', name: 'LAESTRYGONIANS', loss: '−484 · 11 SHIPS', ref: 'BK 10', lx: 95, ly: 30, anchor: 'start', ll: [92, 33] },
  { ...S(13.05, 41.23), men: 37, ships: 1, years: 1.1,
    c: '#4a7ab5', stayC: '#8fb0d9', name: 'CIRCE · ONE YEAR', loss: '−1', ref: 'BK 10', lx: 207, ly: 46, anchor: 'start',
    stay: 2.1 },
  { ...S(14.25, 40.55), men: 37, ships: 1, years: 2.2,
    c: '#7a8a1e', name: 'SIRENS', ref: 'BK 12', lx: 245, ly: 72, anchor: 'start' },
  { ...S(15.63, 38.25), men: 31, ships: 1, years: 2.25,
    c: '#b0439a', name: 'SCYLLA', loss: '−6', ref: 'BK 12', lx: 272, ly: 118, anchor: 'start', ll: [276, 122] },
  { ...S(15.1, 36.9), men: 1, ships: 0, years: 2.35,
    c: '#3466c2', stayC: '#a8b0bc', name: 'THRINACIA', loss: '−30', ref: 'BK 12', lx: 246, ly: 227, anchor: 'start', ll: [250, 217],
    stay: 2.45 },
  { ...S(14.25, 36.05), men: 1, ships: 0, years: 2.6,
    c: '#7b5cc4', stayC: '#d49ec2', name: 'OGYGIA · CALYPSO · SEVEN YEARS', ref: 'BK 5', lx: 240, ly: 291, anchor: 'start', ll: [236, 287],
    stay: 9.6 },
  { ...S(19.85, 39.62), men: 1, ships: 0, years: 9.7,
    c: '#0f8a8a', name: 'SCHERIA', ref: 'BK 6–12', lx: 429, ly: 96, anchor: 'start' },
  { ...S(20.7, 38.37), men: 1, ships: 0, years: 10,
    c: '#0f8040', name: 'ITHACA · 1 MAN · YEAR 10', lx: 525, ly: 200, anchor: 'end', ll: [448, 190] },
];

// Standalone plate labels: numbered callouts keep the route readable.
// Only annotation positions move; all stops, bands, and timing stay unchanged.
const LABEL_POSITIONS: readonly [number, number][] = [
  [657, 111], [599, 41], [553, 237], [123, 324], [218, 177],
  [223, 135], [397, 171], [69, 23], [174, 28], [248, 54],
  [311, 140], [304, 211], [202, 249], [417, 80], [477, 168],
];
const NAMED_STOPS = STOPS.map((stop, index) => ({ stop, index }))
  .filter(({ stop }) => !stop.silent)
  .map((entry, i) => ({ ...entry, number: i + 1, label: LABEL_POSITIONS[i] }));

const GLIMPSE_I = STOPS.findIndex((s) => s.open);
const CIRCE_I = STOPS.findIndex((s) => s.name?.startsWith('CIRCE'));
const OGYGIA_I = STOPS.findIndex((s) => s.name?.startsWith('OGYGIA'));

interface Item {
  kind: 'leg' | 'stay';
  /** Stop index the leg arrives at / the stay happens at. */
  i: number;
  t0: number;
  t1: number;
  y0: number;
  y1: number;
}

// The sailing schedule: leg duration ∝ chart distance (floored for
// legibility); stays pause the band ∝ the years spent there. Built per pace
// so hosts can slow the clock · the scrolly runs at reading speed while the
// standalone figure keeps its quick tempo.
interface Schedule {
  items: Item[];
  total: number;
  /** Pause targets: every named stop, plus silent stops where the outgoing
      band changes color (the blown-back return ending at unnamed Aeolia). */
  stepTimes: number[];
}

const buildSchedule = (rate: number, legMin: number, pxPerSec: number): Schedule => {
  const items: Item[] = [];
  let t = 0;
  for (let i = 1; i < STOPS.length; i++) {
    const prev = STOPS[i - 1];
    if (prev.stay !== undefined) {
      const dur = (prev.stay - prev.years) * rate;
      items.push({ kind: 'stay', i: i - 1, t0: t, t1: t + dur, y0: prev.years, y1: prev.stay });
      t += dur;
    }
    const departYears = prev.stay ?? prev.years;
    const dist = Math.hypot(STOPS[i].x - prev.x, STOPS[i].y - prev.y);
    const dur = Math.max(legMin, dist / pxPerSec);
    items.push({ kind: 'leg', i, t0: t, t1: t + dur, y0: departYears, y1: STOPS[i].years });
    t += dur;
  }
  const total = items[items.length - 1].t1;
  const stepTimes = [
    0,
    ...items
      .filter(
        (it) =>
          it.kind === 'leg' &&
          (STOPS[it.i].name || (it.i < STOPS.length - 1 && STOPS[it.i + 1].c !== STOPS[it.i].c))
      )
      .map((it) => it.t1),
  ];
  return { items, total, stepTimes };
};

const DEFAULT_SCHEDULE = buildSchedule(RATE, LEG_MIN, PX_PER_SEC);

// Scrub support: the time strip is linear in YEARS, so dragging inverts the
// story-time schedule back to clock time.
const tForYears = (sched: Schedule, y: number) => {
  const c = Math.max(0, Math.min(10, y));
  for (const item of sched.items) {
    if (c <= item.y1) {
      return item.y1 === item.y0
        ? item.t1
        : item.t0 + ((c - item.y0) / (item.y1 - item.y0)) * (item.t1 - item.t0);
    }
  }
  return sched.total;
};

/** Voyage years elapsed at clock time t · the strip's forward mapping. */
const yearsAtT = (sched: Schedule, t: number) => {
  let y = 0;
  for (const item of sched.items) {
    if (t >= item.t1) y = item.y1;
    else if (t > item.t0) return lerp(item.y0, item.y1, (t - item.t0) / (item.t1 - item.t0));
    else break;
  }
  return y;
};

const bandWidth = (men: number) => 1.2 + men * 0.028;
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
/** Time-strip x for a year value: 0–10 yrs → 40–640. */
const sx = (years: number) => 40 + years * 60;

const MONO = 'var(--font-geist-mono), monospace';

/** Unit direction and normal of a→b. */
const dir = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  return { ux, uy, nx: -uy, ny: ux };
};

/** Band quad for a→(ex,ey) at width w · butt ends, so cuts stay square. */
const quad = (a: Stop, ex: number, ey: number, w: number) => {
  const { nx, ny } = dir(a, { x: ex, y: ey });
  const h = w / 2;
  return `${a.x + nx * h},${a.y + ny * h} ${ex + nx * h},${ey + ny * h} ${ex - nx * h},${ey - ny * h} ${a.x - nx * h},${a.y - ny * h}`;
};

/** Chevron at fraction `at` along a→b, pointing toward b. */
const chev = (a: Stop, b: Stop, at: number) => {
  const { ux, uy, nx, ny } = dir(a, b);
  const mx = lerp(a.x, b.x, at);
  const my = lerp(a.y, b.y, at);
  const bx = mx - 4 * ux;
  const by = my - 4 * uy;
  return `${bx + 5 * nx},${by + 5 * ny} ${mx + 5 * ux},${my + 5 * uy} ${bx - 5 * nx},${by - 5 * ny}`;
};

/** Square miter joint at the OUTGOING width: fills the elbow between two
    legs without rounding it, so at a loss the incoming band's wider butt
    face stays exposed as a sharp right-angle step. */
const joint = (i: number) => {
  const s = STOPS[i];
  const din = dir(STOPS[i - 1], s);
  const dout = dir(s, STOPS[i + 1]);
  let nx = dout.nx;
  let ny = dout.ny;
  if (nx * din.nx + ny * din.ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const h = bandWidth(s.men) / 2;
  return `${s.x + din.nx * h},${s.y + din.ny * h} ${s.x + nx * h},${s.y + ny * h} ${s.x - din.nx * h},${s.y - din.ny * h} ${s.x - nx * h},${s.y - ny * h}`;
};

// ---- The muster roll: 12 ships of 50, drawn above the chart. Every body is
// an ink dot that never leaves the register; the dead are crossed out OVER
// the dot with a loss-orange × that pops in (back-out scale) and never comes
// back. Lost ships get a larger × across the still-drawn hull. ----

const SHIP_X = Array.from({ length: 12 }, (_, g) => 16 + g * 53);

const xMark = (x: number, y: number, r: number) =>
  `M${x - r} ${y - r}L${x + r} ${y + r}M${x - r} ${y + r}L${x + r} ${y - r}`;

// Who is aboard ship g at a given state of the voyage. Ismarus takes six from
// every ship; the Cyclops eats six of the flagship's crew; Laestrygonia sinks
// every hull but the flagship · after that the whole tally lives in ship 0.
const aliveInShip = (g: number, men: number, ships: number) => {
  if (ships < 12) return g === 0 ? men : 0;
  if (g === 0) return men === 600 ? 50 : men === 528 ? 44 : 38;
  return men === 600 ? 50 : 44;
};

// Muster layout, permanent: the flagship · the ship the story follows ·
// drawn enlarged at the sheet's center, the other eleven small in flanking
// slots (five left, six right). Each group is authored at its original
// center (39 + 53g) and placed by a static transform.
const musterTransform = (g: number): string => {
  const orig = 39 + 53 * g;
  const target = g === 0 ? 365 : g <= 5 ? 158 + (g - 1) * 38 : 420 + (g - 6) * 38;
  const scale = g === 0 ? 1.35 : 0.7;
  return `translate(${target - orig}px, ${g === 0 ? 2 : 0}px) scale(${scale})`;
};

const Muster = memo(function Muster({ men, ships }: { men: number; ships: number }) {
  return (
    <g>
      {SHIP_X.map((x0, g) => {
        const alive = aliveInShip(g, men, ships);
        const shipAfloat = g === 0 ? ships > 0 : ships === 12;
        const cx = x0 + 20.7;
        return (
          <g
            key={g}
            style={{
              transform: musterTransform(g),
              transformBox: 'fill-box',
              transformOrigin: 'center',
            }}
          >
            <g fill="var(--text-primary)">
              <polygon points={`${cx - 6},-46 ${cx + 6},-46 ${cx + 3.5},-42.5 ${cx - 3.5},-42.5`} />
              <rect x={cx - 0.6} y={-53} width={1.2} height={7} />
            </g>
            <path
              d={xMark(cx, -47.5, 5)}
              fill="none"
              stroke={LOSS}
              strokeWidth={1.1}
              strokeLinecap="round"
              opacity={shipAfloat ? 0 : 0.9}
              style={{
                transition: 'opacity 0.3s ease, transform 0.5s cubic-bezier(0.34, 1.8, 0.64, 1)',
                transform: shipAfloat ? 'scale(0)' : 'scale(1)',
                transformBox: 'fill-box',
                transformOrigin: 'center',
              }}
            />
            {Array.from({ length: 50 }, (_, k) => {
              const dx = x0 + (k % 10) * 4.6;
              const dy = -32 + Math.floor(k / 10) * 4.6;
              const live = k < alive;
              return (
                <g key={k}>
                  <circle cx={dx} cy={dy} r={1.5} fill="var(--text-primary)" />
                  <path
                    d={xMark(dx, dy, 1.8)}
                    fill="none"
                    stroke={LOSS}
                    strokeWidth={0.8}
                    strokeLinecap="round"
                    opacity={live ? 0 : 0.9}
                    style={{
                      transition: 'opacity 0.3s ease, transform 0.45s cubic-bezier(0.34, 1.8, 0.64, 1)',
                      transform: live ? 'scale(0)' : 'scale(1)',
                      transformBox: 'fill-box',
                      transformOrigin: 'center',
                    }}
                  />
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
});

/** External transport handle, in voyage YEARS (the strip's unit): seek jumps,
    sail animates forward (or jumps when going backward / reduced motion).
    Used by scroll-driven essays to drive the figure. */
export type VoyageHandle = {
  seekYears: (y: number) => void;
  sailToYears: (y: number) => void;
};

export default function OdysseyReturn({
  land,
  voyageRef,
  onStepForward,
  onStepBack,
  onReset,
  onSail,
  onPlayingChange,
  pace,
}: {
  land?: string;
  voyageRef?: { current: VoyageHandle | null };
  /** Scroll-driven hosts REPLACE the step buttons' transport with these ·
      the buttons scroll the essay, and the scroll (scrollama) sails the
      figure, so page and band never disagree. */
  onStepForward?: () => void;
  onStepBack?: () => void;
  /** Runs after the internal reset · hosts scroll back to the top. */
  onReset?: () => void;
  /** Fires as the clock runs while playing, in voyage years · scroll hosts
      follow the sail with it. */
  onSail?: (years: number) => void;
  /** Play/pause edge · while playing, scroll hosts stand down as drivers. */
  onPlayingChange?: (playing: boolean) => void;
  /** Clock override: stay seconds per voyage-year, minimum leg seconds, and
      band drawing speed in chart px/s. The scrolly slows the sail to reading
      speed with a larger legMin and a slower pen. */
  pace?: { rate?: number; legMin?: number; pxPerSec?: number };
} = {}) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  // The clock this instance sails by; aliases keep the body reading plainly.
  const paceRate = pace?.rate;
  const paceLegMin = pace?.legMin;
  const pacePxPerSec = pace?.pxPerSec;
  const hasCustomPace = Boolean(pace);
  const sched = useMemo(
    () => hasCustomPace
      ? buildSchedule(paceRate ?? RATE, paceLegMin ?? LEG_MIN, pacePxPerSec ?? PX_PER_SEC)
      : DEFAULT_SCHEDULE,
    [hasCustomPace, paceRate, paceLegMin, pacePxPerSec],
  );
  const ITEMS = sched.items;
  const TOTAL = sched.total;
  const STEP_TIMES = sched.stepTimes;
  // Prose↔figure highlight hooks: essays can point at these via <FigRef id>.
  const [hl, setHl] = useState<string | null>(null);
  useEffect(() => {
    const unsubs = HIGHLIGHT_CHANNELS.map((id) =>
      subscribeHighlight(id, (on) => setHl(on ? id : null))
    );
    return () => unsubs.forEach((u) => u());
  }, []);
  const raf = useRef(0);
  const tRef = useRef(0);
  const scrubbing = useRef(false);
  // When set, the clock pulls in and pauses at this time · clicking the
  // button mid-sail schedules a stop at the next named stop's arrival.
  const pauseAtRef = useRef<number | null>(null);
  const clipId = useId();
  // Latest onSail, reachable from the rAF loop: the clock's completion paths
  // pause and land in the SAME commit, so the playing-gated effect below
  // never sees the final position · they emit it directly instead.
  const onSailRef = useRef(onSail);
  useEffect(() => {
    onSailRef.current = onSail;
  }, [onSail]);

  useEffect(() => {
    if (!playing) return;
    const start = performance.now() - tRef.current * 1000;
    const step = (now: number) => {
      const el = (now - start) / 1000;
      const stopAt = pauseAtRef.current;
      if (stopAt !== null && el >= stopAt) {
        pauseAtRef.current = null;
        tRef.current = stopAt;
        setT(stopAt);
        setPlaying(false);
        onSailRef.current?.(yearsAtT(sched, stopAt));
        return;
      }
      if (el >= TOTAL) {
        tRef.current = TOTAL;
        setT(TOTAL);
        setPlaying(false);
        onSailRef.current?.(yearsAtT(sched, TOTAL));
        return;
      }
      tRef.current = el;
      setT(el);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, sched, TOTAL]);

  const play = useCallback(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      tRef.current = TOTAL;
      setT(TOTAL);
      setPlaying(false);
      return;
    }
    if (playing) {
      pauseAtRef.current = STEP_TIMES.find((s) => s > tRef.current + 0.01) ?? TOTAL;
      return;
    }
    pauseAtRef.current = null;
    if (tRef.current >= TOTAL) {
      tRef.current = 0;
      setT(0);
    }
    setPlaying(true);
  }, [playing, STEP_TIMES, TOTAL]);

  // Manual navigation always pauses: dragging the strip scrubs continuously,
  // the step buttons jump between named stops.
  const seek = useCallback((nt: number) => {
    const c = Math.max(0, Math.min(TOTAL, nt));
    pauseAtRef.current = null;
    setPlaying(false);
    tRef.current = c;
    setT(c);
  }, [TOTAL]);
  const stepBack = useCallback(() => {
    seek([...STEP_TIMES].reverse().find((s) => s < tRef.current - 0.01) ?? 0);
  }, [seek, STEP_TIMES]);
  // Sail forward to a target under the clock (reusing the pause-at machinery);
  // backward it jumps · the voyage never un-sails.
  const sailTo = useCallback(
    (nt: number) => {
      const c = Math.max(0, Math.min(TOTAL, nt));
      if (c <= tRef.current + 0.01 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        seek(c);
        return;
      }
      pauseAtRef.current = c;
      setPlaying(true);
    },
    [seek, TOTAL]
  );
  useEffect(() => {
    if (!voyageRef) return;
    voyageRef.current = {
      seekYears: (y) => seek(tForYears(sched, y)),
      sailToYears: (y) => sailTo(tForYears(sched, y)),
    };
    return () => {
      voyageRef.current = null;
    };
  }, [voyageRef, seek, sailTo, sched]);
  // Shareable cursor (default-on url state): ?f112_y=<years> restores the
  // voyage position; the sail mirrors back, debounced. Applied post-mount
  // only · SSR renders year zero (hydration rule in useFigUrlState).
  const [sharedYears, writeYears] = useFigUrlState(figParamKey('1.1.2', 'y'));
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const y = sharedYears != null ? parseFloat(sharedYears) : NaN;
    if (!Number.isNaN(y) && y > 0) seek(tForYears(sched, Math.max(0, Math.min(10, y))));
  }, [sharedYears, seek, sched]);
  const years0 = yearsAtT(sched, t);
  useEffect(() => {
    writeYears(years0 > 0.01 ? years0.toFixed(2) : null);
  }, [years0, writeYears]);

  const stepForward = useCallback(() => {
    seek(STEP_TIMES.find((s) => s > tRef.current + 0.01) ?? TOTAL);
  }, [seek, STEP_TIMES, TOTAL]);
  const scrubTo = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      const svg = e.currentTarget.ownerSVGElement;
      if (!svg) return;
      const r = svg.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 720;
      seek(tForYears(sched, (x - 40) / 60));
    },
    [seek, sched]
  );

  // Current years elapsed on the voyage.
  const years = yearsAtT(sched, t);

  // Report the sail to scroll hosts: play/pause edges, then position every
  // frame while the clock runs.
  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);
  useEffect(() => {
    if (playing) onSail?.(years);
  }, [playing, years, onSail]);

  // Latest stop the band has reached.
  let reached = 0;
  for (const item of ITEMS) {
    if (item.kind === 'leg' && t >= item.t1) reached = item.i;
  }
  const men = STOPS[reached].men;
  const ships = STOPS[reached].ships;
  const currentStop = NAMED_STOPS.filter(({ index }) => index <= reached).at(-1)!;
  const done = t >= TOTAL;
  const started = t > 0;

  const arrived = (i: number) => i === 0 || ITEMS.some((it) => it.kind === 'leg' && it.i === i && t >= it.t1);
  // The joint at stop i is painted in the OUTGOING leg's color, so it must
  // wait for that leg to actually depart · on arrival (e.g. paused at a step)
  // it would flash the next color before the course has been sailed.
  const departed = (i: number) => ITEMS.some((it) => it.kind === 'leg' && it.i === i + 1 && t > it.t0);

  return (
    <div className="voyage">
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', padding: '1rem 1.25rem 0.25rem' }}>
        <button
          onClick={play}
          style={{
            padding: '0.5rem 0.875rem',
            fontSize: '0.875rem',
            borderRadius: '3px',
            border: '1px solid var(--accent)',
            cursor: 'pointer',
            background: 'transparent',
            color: 'var(--accent)',
            // Pinned to the widest caption so the label swap never resizes
            // the button and shifts the step controls beside it.
            minWidth: '8.25rem',
            textAlign: 'center',
          }}
        >
          {playing
            ? pauseAtRef.current !== null
              ? 'To next stop…'
              : 'Sailing…'
            : done
              ? 'Replay'
              : started
                ? 'Resume'
                : 'Play the return'}
        </button>
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          <button
            onClick={onStepBack ?? stepBack}
            disabled={!started}
            aria-label="Step back one stop"
            style={{
              padding: '0.5rem 0.7rem',
              fontSize: '0.875rem',
              borderRadius: '3px',
              border: '1px solid var(--accent)',
              background: 'transparent',
              color: 'var(--accent)',
              cursor: started ? 'pointer' : 'default',
              opacity: started ? 1 : 0.35,
            }}
          >
            ‹
          </button>
          <button
            onClick={onStepForward ?? stepForward}
            disabled={done}
            aria-label="Step forward one stop"
            style={{
              padding: '0.5rem 0.7rem',
              fontSize: '0.875rem',
              borderRadius: '3px',
              border: '1px solid var(--accent)',
              background: 'transparent',
              color: 'var(--accent)',
              cursor: done ? 'default' : 'pointer',
              opacity: done ? 0.35 : 1,
            }}
          >
            ›
          </button>
          <button
            onClick={() => {
              seek(0);
              onReset?.();
            }}
            disabled={!started}
            aria-label="Reset to the start"
            style={{
              padding: '0.5rem 0.7rem',
              fontSize: '0.875rem',
              borderRadius: '3px',
              border: '1px solid var(--accent)',
              background: 'transparent',
              color: 'var(--accent)',
              cursor: started ? 'pointer' : 'default',
              opacity: started ? 1 : 0.35,
            }}
          >
            ↺
          </button>
        </div>
      </div>

      <div className="voyage-readout" aria-live="off">
        <span><strong>{men}</strong> {men === 1 ? 'man' : 'men'} remaining</span>
        <span><strong>{600 - men}</strong> lost · {(((600 - men) / 600) * 100).toFixed(1)}%</span>
        <span><strong>{ships}</strong> ships</span>
      </div>
      <p className="voyage-current"><span className="voyage-number">{currentStop.number}</span> {currentStop.stop.name}{currentStop.stop.loss && <strong> {currentStop.stop.loss}</strong>}{currentStop.stop.ref && <span> · {currentStop.stop.ref}</span>}</p>
      <p className="voyage-scroll-hint">Scroll the map sideways to follow the full route.</p>
      <div style={{ overflowX: 'auto' }}>
        <svg
          viewBox="0 -60 720 490"
          style={{ minWidth: 560, width: '100%', height: 'auto', display: 'block' }}
          // role="group", not "img": the svg contains a real slider control,
          // and interactive descendants inside an image role are invisible to
          // assistive tech (axe: nested-interactive).
          role="group"
          aria-label="Flow map of Odysseus's return from Troy across the Mediterranean: twelve ships and 600 men leave, one man arrives"
        >
          {/* The muster: every ship, every man, faded as they are lost */}
          <Muster men={men} ships={ships} />
          {/* Prose-highlight ring around the flagship's muster block */}
          <ellipse
            cx={365}
            cy={-30}
            rx={34}
            ry={30}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.5}
            style={{ opacity: hl === 'odyssey-flagship' ? 1 : 0, transition: 'opacity 0.3s ease' }}
          />
          {/* The chart: real coastlines; the sheet's dot grid is the sea.
              A `land` prop (a path in this frame's coordinates, possibly
              unclipped) overrides the compiled region · used by map-lab. */}
          <clipPath id={clipId}>
            <rect x={30} y={20} width={670} height={350} />
          </clipPath>
          <path
            d={land ?? LAND_D}
            clipPath={land ? `url(#${clipId})` : undefined}
            fill={LAND}
            stroke={COAST}
            strokeWidth={0.7}
            strokeLinejoin="round"
            fillRule="evenodd"
          />

          {/* Planned course, faint · the chart before the voyage is drawn on it */}
          <polyline
            points={STOPS.map((s) => `${s.x},${s.y}`).join(' ')}
            fill="none"
            stroke="var(--text-tertiary)"
            strokeWidth={1}
            strokeDasharray="2 6"
            opacity={0.5}
          />

          {/* The band: filled quads with butt ends · losses step down square.
              Each junction's square miter fill (which leaves the incoming
              band's wider face exposed so the bar visibly steps down) paints
              IMMEDIATELY after its incoming leg, so later legs cross OVER
              earlier joints · a trailing joint layer left stale miters
              sitting on top of bands that arrived after them. */}
          {ITEMS.filter((it) => it.kind === 'leg').map((it) => {
            const from = STOPS[it.i - 1];
            const to = STOPS[it.i];
            if (t <= it.t0) return null;
            const f = t >= it.t1 ? 1 : (t - it.t0) / (it.t1 - it.t0);
            // Highlight rules: pointing at the ambush keeps only the red run
            // at full ink; pointing at Calypso recedes the whole voyage so
            // her stay ring carries the sheet.
            const dim =
              (hl === 'odyssey-laestrygonians' && to.c !== '#c43d3d') || hl === 'odyssey-calypso';
            return (
              <g key={it.i} style={{ opacity: dim ? 0.2 : 1, transition: 'opacity 0.3s ease' }}>
                <polygon
                  points={quad(from, lerp(from.x, to.x, f), lerp(from.y, to.y, f), bandWidth(from.men))}
                  fill={to.c}
                />
                {it.i < STOPS.length - 1 && departed(it.i) && (
                  <polygon points={joint(it.i)} fill={STOPS[it.i + 1].c} />
                )}
              </g>
            );
          })}
          {/* Stay rings: the periods spent in one place, in their strip color */}
          {STOPS.map((s, i) =>
            s.stayC && arrived(i) ? (
              <circle
                key={`s${i}`}
                cx={s.x}
                cy={s.y}
                r={7.5}
                fill="none"
                stroke={s.stayC}
                strokeWidth={hl === 'odyssey-calypso' && i === OGYGIA_I ? 4.5 : 2.5}
                style={{ transition: 'stroke-width 0.3s ease' }}
              />
            ) : null
          )}
          {/* Direction chevrons on the Aeolus loop: out east, blown back west */}
          <g stroke="var(--bg-primary)" strokeWidth={2} fill="none" strokeLinecap="round">
            <polyline points={chev(STOPS[GLIMPSE_I - 1], STOPS[GLIMPSE_I], 0.5)} style={{ opacity: arrived(GLIMPSE_I) ? 1 : 0, transition: 'opacity 0.5s ease' }} />
            <polyline points={chev(STOPS[GLIMPSE_I], STOPS[GLIMPSE_I + 1], 0.5)} style={{ opacity: arrived(GLIMPSE_I + 1) ? 1 : 0, transition: 'opacity 0.5s ease' }} />
          </g>

          {/* Callout numbers map to the readable key below the chart. */}
          {NAMED_STOPS.map(({ stop: s, index: i, number, label: [lx, ly] }) => {
            const show = arrived(i);
            const current = i === currentStop.index;
            const { ux, uy } = dir({ x: lx, y: ly }, s);
            return (
              <g key={i}>
                <line x1={lx + ux * 14} y1={ly + uy * 14} x2={s.x - ux * 5} y2={s.y - uy * 5}
                  stroke="var(--text-tertiary)" strokeWidth={1} />
                <circle cx={s.x} cy={s.y} r={s.open ? 3 : 2.6}
                  fill={s.open ? 'var(--bg-primary)' : 'var(--text-primary)'}
                  stroke="var(--text-primary)" strokeWidth={1} />
                {i === STOPS.length - 1 && <circle cx={s.x} cy={s.y} r={6} fill="none" stroke="var(--text-primary)" strokeWidth={1} />}
                <circle cx={lx} cy={ly} r={14} fill={current ? 'var(--text-primary)' : 'var(--bg-primary)'}
                  stroke={show ? 'var(--text-primary)' : 'var(--text-tertiary)'} strokeWidth={current ? 1.5 : 1} />
                <text x={lx} y={ly + 5.5} textAnchor="middle" fontSize={16} fontFamily={MONO}
                  fill={current ? 'var(--bg-primary)' : 'var(--text-primary)'}>{number}</text>
              </g>
            );
          })}

          {/* Time strip: ten years, most of them parked */}
          <g fontFamily={MONO}>
            <text x={40} y={388} fontSize={14.5} letterSpacing="0.1em" fill="var(--text-tertiary)">YEARS FROM TROY</text>
            <line x1={40} y1={399} x2={640} y2={399} stroke="var(--border-hover)" strokeWidth={1} />
            {Array.from({ length: 11 }, (_, y) => (
              <g key={y}>
                <line x1={sx(y)} y1={396} x2={sx(y)} y2={402} stroke="var(--text-tertiary)" strokeWidth={1} />
                {(y === 0 || y === 5 || y === 10) && (
                  <text x={sx(y)} y={414} textAnchor="middle" fontSize={14.5} fill="var(--text-tertiary)">{y}</text>
                )}
              </g>
            ))}
            {ITEMS.map((item) => {
              if (years <= item.y0) return null;
              const c = item.kind === 'stay' ? STOPS[item.i].stayC ?? BAND : STOPS[item.i].c;
              return (
                <line
                  key={`t${item.kind}${item.i}`}
                  x1={sx(item.y0)}
                  y1={399}
                  x2={sx(Math.min(years, item.y1))}
                  y2={399}
                  stroke={c}
                  strokeWidth={5}
                />
              );
            })}
            <line
              x1={sx(years)}
              y1={393}
              x2={sx(years)}
              y2={405}
              stroke="var(--text-primary)"
              strokeWidth={1.5}
            />
            {started && years >= 2 && (
              <text x={sx(years) + 5} y={392} fontSize={14.5} fontWeight={700} fill="var(--text-primary)">
                YR {years.toFixed(1)}
              </text>
            )}
            <g style={{ opacity: arrived(CIRCE_I) ? 1 : 0, transition: 'opacity 0.5s ease' }}>
              <text x={sx(1.6)} y={424} textAnchor="middle" fontSize={14.5} letterSpacing="0.06em" fill="#4a7ab5">CIRCE · 1 YR</text>
            </g>
            <g style={{ opacity: arrived(OGYGIA_I) ? 1 : 0, transition: 'opacity 0.5s ease' }}>
              <text x={sx(6.1)} y={424} textAnchor="middle" fontSize={14.5} letterSpacing="0.06em" fill="#b05f92">CALYPSO · 7 YRS</text>
            </g>
          </g>

          {/* Scrubber: drag the time strip to move through the voyage;
              arrow keys step stop to stop when it has focus */}
          <rect
            x={30}
            y={376}
            width={620}
            height={54}
            fill="transparent"
            role="slider"
            aria-label="Voyage timeline · drag to scrub, arrow keys to step by stop"
            aria-valuemin={0}
            aria-valuemax={10}
            aria-valuenow={Math.round(years * 10) / 10}
            tabIndex={0}
            style={{ cursor: 'ew-resize', touchAction: 'none' }}
            onPointerDown={(e) => {
              scrubbing.current = true;
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // synthetic or already-released pointers can't be captured
              }
              scrubTo(e);
            }}
            onPointerMove={(e) => {
              if (scrubbing.current) scrubTo(e);
            }}
            onPointerUp={() => {
              scrubbing.current = false;
            }}
            onPointerCancel={() => {
              scrubbing.current = false;
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                stepBack();
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                stepForward();
              }
            }}
          />
        </svg>
      </div>
      <ol className="voyage-key" aria-label="Voyage stops in order">
        {NAMED_STOPS.map(({ stop, index, number }) => <li key={index} aria-current={index === currentStop.index ? 'step' : undefined}>
          <span className="voyage-number">{number}</span>
          <span>{stop.name}{stop.loss && <strong> {stop.loss}</strong>}{stop.ref && <small>{stop.ref}</small>}</span>
        </li>)}
      </ol>
    </div>
  );
}
