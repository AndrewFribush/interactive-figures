import { useMemo, useState } from 'react';
import { MONO, INK, SEC, DIM, RULE, LOSS } from './figureTokens';
import { UEMPMED } from './searchDuration.data';

// fig 1.1.12 · the job-search simulator. A probabilistic instrument in the
// essay tradition (the Gale-Shapley machines): set your odds, run a
// thousand searches, watch the distribution. The model is three honest
// knobs — applications per week, interview rate, offer rate — so a week
// ends the search with probability 1 − (1 − i·o)^a. Defaults are
// calibrated so the simulated median lands on the measured one (fig
// 1.1.9's BLS series), which is drawn on the histogram in the loss color:
// the model must answer to the measurement. Seeded PRNG so the server
// render is deterministic; RUN AGAIN reseeds.

const BLS_WEEKS = UEMPMED[UEMPMED.length - 1][1];
const N = 1000;
const CAP = 78; // censor at a year and a half; the tail is the story

// mulberry32: tiny seeded PRNG, deterministic across server and client.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulate(apps: number, interview: number, offer: number, seed: number) {
  const weeklyP = 1 - Math.pow(1 - (interview / 100) * (offer / 100), apps);
  const rand = rng(seed);
  const weeks: number[] = [];
  for (let s = 0; s < N; s++) {
    let w = 1;
    while (w < CAP && rand() >= weeklyP) w++;
    weeks.push(w);
  }
  weeks.sort((x, y) => x - y);
  return {
    weeks,
    weeklyP,
    median: weeks[Math.floor(N / 2)],
    p90: weeks[Math.floor(N * 0.9)],
    censored: weeks.filter((w) => w >= CAP).length,
  };
}

export default function SearchSimulator() {
  const [apps, setApps] = useState(10);
  const [interview, setInterview] = useState(6);
  const [offer, setOffer] = useState(11);
  const [seed, setSeed] = useState(42);

  const sim = useMemo(() => simulate(apps, interview, offer, seed), [apps, interview, offer, seed]);

  const W = 720;
  const H = 440;
  const m = { top: 44, right: 16, bottom: 52, left: 16 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;

  // Histogram over weeks 1..CAP.
  const counts = Array.from({ length: CAP }, (_, i) => sim.weeks.filter((w) => w === i + 1).length);
  const maxC = Math.max(...counts, 1);
  const bw = plotW / CAP;
  const bx = (w: number) => m.left + (w - 1) * bw;
  const by = (c: number) => m.top + (1 - c / maxC) * plotH;

  const controls = [
    { label: 'APPLICATIONS / WEEK', value: apps, set: setApps, min: 1, max: 40, unit: '' },
    { label: 'INTERVIEW RATE', value: interview, set: setInterview, min: 1, max: 30, unit: '%' },
    { label: 'OFFER RATE', value: offer, set: setOffer, min: 2, max: 50, unit: '%' },
  ];

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ minWidth: 480, width: '100%', height: 'auto', display: 'block' }}
          role="img"
          aria-label={`One thousand simulated job searches at your odds: median ${sim.median} weeks, one in ten runs past week ${sim.p90}. The measured national median, ${BLS_WEEKS} weeks, is marked for comparison.`}
        >
          <text x={0} y={14} fontFamily={MONO} fontSize={11} fill={SEC} letterSpacing="0.04em">
            {N.toLocaleString('en-US')} SEARCHES AT YOUR ODDS · WEEKS UNTIL THE FIRST OFFER
          </text>
          <line x1={0} y1={26} x2={W} y2={26} stroke={RULE} strokeWidth={1} />

          {counts.map((c, i) =>
            c > 0 ? (
              <rect
                key={i}
                x={bx(i + 1) + 0.5}
                y={by(c)}
                width={Math.max(bw - 1, 1)}
                height={m.top + plotH - by(c)}
                fill={INK}
                opacity={i + 1 >= CAP ? 1 : 0.78}
              />
            ) : null,
          )}

          {/* The simulated median and tail. */}
          <line x1={bx(sim.median) + bw / 2} y1={m.top - 4} x2={bx(sim.median) + bw / 2} y2={m.top + plotH} stroke={INK} strokeWidth={1.4} />
          <text x={bx(sim.median) + bw / 2 + 6} y={m.top + 10} fontFamily={MONO} fontSize={10.5} fontWeight={700} fill={INK}>
            YOUR MEDIAN: WEEK {sim.median}
          </text>
          <text x={bx(sim.p90) + bw / 2 + 6} y={m.top + 44} fontFamily={MONO} fontSize={10} fill={SEC}>
            1 IN 10 RUNS PAST WEEK {sim.p90}
          </text>
          <line x1={bx(sim.p90) + bw / 2} y1={m.top + 34} x2={bx(sim.p90) + bw / 2} y2={m.top + plotH} stroke={DIM} strokeWidth={1} strokeDasharray="3 3" />

          {/* The measurement the model answers to. */}
          <line x1={bx(Math.round(BLS_WEEKS)) + bw / 2} y1={m.top + 56} x2={bx(Math.round(BLS_WEEKS)) + bw / 2} y2={m.top + plotH} stroke={LOSS} strokeWidth={1.4} />
          <text x={bx(Math.round(BLS_WEEKS)) + bw / 2 + 6} y={m.top + 70} fontFamily={MONO} fontSize={10} fill={LOSS}>
            THE MEASURED MEDIAN: {BLS_WEEKS} WEEKS (FIG 1.1.9)
          </text>

          {sim.censored > 0 && (
            <text x={W - m.right} y={m.top + plotH - 8} fontFamily={MONO} fontSize={9.5} fill={LOSS} textAnchor="end">
              {sim.censored} OF {N.toLocaleString('en-US')} STILL SEARCHING AT WEEK {CAP}
            </text>
          )}

          {[13, 26, 39, 52, 65, 78].map((wk) => (
            <g key={wk}>
              <line x1={bx(wk) + bw / 2} y1={m.top + plotH} x2={bx(wk) + bw / 2} y2={m.top + plotH + 5} stroke={DIM} strokeWidth={1} />
              <text x={bx(wk) + bw / 2} y={m.top + plotH + 17} fontFamily={MONO} fontSize={10} fill={DIM} textAnchor="middle">
                {wk === 26 ? 'HALF A YEAR' : wk === 52 ? 'A YEAR' : wk}
              </text>
            </g>
          ))}

          <line x1={0} y1={H - 22} x2={W} y2={H - 22} stroke={RULE} strokeWidth={1} />
          <text x={0} y={H - 7} fontFamily={MONO} fontSize={10} fill={SEC}>
            A WEEK ENDS THE SEARCH WITH P = 1−(1−I·O)^A · EVERY KNOB IS YOURS
          </text>
          <text x={W} y={H - 7} fontFamily={MONO} fontSize={10} fill={INK} textAnchor="end">
            DEFAULTS TUNED TO THE BLS MEDIAN · SEEDED
          </text>
        </svg>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 mt-3">
        {controls.map((c) => (
          <label key={c.label} className="font-mono text-[0.6875rem] font-bold uppercase tracking-[0.04em] text-secondary flex flex-col gap-1.5">
            <span>
              {c.label}: <span className="text-primary">{c.value}{c.unit}</span>
            </span>
            <input
              type="range"
              min={c.min}
              max={c.max}
              value={c.value}
              onChange={(e) => c.set(Number(e.target.value))}
              className="w-36 accent-[var(--accent)]"
            />
          </label>
        ))}
        <button
          type="button"
          onClick={() => setSeed((s) => s + 1)}
          className="font-mono text-[0.75rem] font-bold uppercase tracking-[0.04em] border rounded px-3 py-1.5 text-accent hover:bg-tertiary cursor-pointer"
          style={{ borderColor: 'var(--border-hover)' }}
        >
          Run {N.toLocaleString('en-US')} searches again
        </button>
      </div>
    </div>
  );
}
