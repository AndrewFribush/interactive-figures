'use client';

import React, { useReducer, useRef, useCallback, useEffect, useState, useMemo } from 'react';

// --- Types ---

type PersonState = 'idle' | 'proposing' | 'considering' | 'matched' | 'rejected';

interface Person {
  name: string;
  preferences: number[];
}

interface Scenario {
  label: string;
  proposers: Person[];
  receivers: Person[];
}

interface StepResult {
  type: 'propose' | 'accept' | 'reject' | 'replace';
  proposer: number;
  receiver: number;
  replaced?: number;
  message: string;
  round: number;
}

interface SimState {
  proposerStates: PersonState[];
  receiverStates: PersonState[];
  matches: Map<number, number>;
  proposalIndex: number[];
  freeProposers: Set<number>;
  activeProposal: { proposer: number; receiver: number } | null;
  log: StepResult[];
  round: number;
  phase: 'idle' | 'running' | 'stepping' | 'done';
}

type SimAction =
  | { type: 'RESET'; scenario: Scenario }
  | { type: 'STEP'; step: StepResult }
  | { type: 'HIGHLIGHT_PROPOSAL'; proposer: number; receiver: number }
  | { type: 'CLEAR_HIGHLIGHT' }
  | { type: 'SET_PHASE'; phase: SimState['phase'] }
  | { type: 'MARK_DONE' };

// --- Names (all unique initials) ---

const MEN = ['Alex', 'Ben', 'Chris', 'Dan', 'Ethan', 'Frank', 'Grant', 'Henry', 'Ian', 'Kyle'];
const WOMEN = ['Lily', 'Mia', 'Nora', 'Olivia', 'Paige', 'Rose', 'Sara', 'Tina', 'Violet', 'Wendy'];

// --- Helpers ---

function randomPermutation(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const N = MEN.length;

function generateScenario(): Scenario {
  return {
    label: 'Random',
    proposers: MEN.map((name) => ({ name, preferences: randomPermutation(N) })),
    receivers: WOMEN.map((name) => ({ name, preferences: randomPermutation(N) })),
  };
}

// --- Algorithm Generator ---

function* galeShapley(scenario: Scenario): Generator<StepResult> {
  const n = scenario.proposers.length;
  const proposalIndex = new Array(n).fill(0);
  const matches = new Map<number, number>();
  const freeProposers = new Set<number>();
  for (let i = 0; i < n; i++) freeProposers.add(i);

  let round = 0;

  while (freeProposers.size > 0) {
    round++;
    const proposersThisRound = [...freeProposers];

    for (const p of proposersThisRound) {
      if (proposalIndex[p] >= n) continue;

      const r = scenario.proposers[p].preferences[proposalIndex[p]];
      proposalIndex[p]++;

      const receiverPrefs = scenario.receivers[r].preferences;
      const currentMatch = matches.get(r);

      if (currentMatch === undefined) {
        matches.set(r, p);
        freeProposers.delete(p);
        yield {
          type: 'accept',
          proposer: p,
          receiver: r,
          round,
          message: `${scenario.proposers[p].name} proposes to ${scenario.receivers[r].name} — accepted!`,
        };
      } else {
        const currentRank = receiverPrefs.indexOf(currentMatch);
        const newRank = receiverPrefs.indexOf(p);

        if (newRank < currentRank) {
          matches.set(r, p);
          freeProposers.delete(p);
          freeProposers.add(currentMatch);
          yield {
            type: 'replace',
            proposer: p,
            receiver: r,
            replaced: currentMatch,
            round,
            message: `${scenario.proposers[p].name} proposes to ${scenario.receivers[r].name} — accepted! ${scenario.proposers[currentMatch].name} is now free.`,
          };
        } else {
          yield {
            type: 'reject',
            proposer: p,
            receiver: r,
            round,
            message: `${scenario.proposers[p].name} proposes to ${scenario.receivers[r].name} — rejected.`,
          };
        }
      }
    }
  }
}

// --- Reducer ---

function initState(scenario: Scenario): SimState {
  const n = scenario.proposers.length;
  return {
    proposerStates: new Array(n).fill('idle'),
    receiverStates: new Array(n).fill('idle'),
    matches: new Map(),
    proposalIndex: new Array(n).fill(0),
    freeProposers: new Set(Array.from({ length: n }, (_, i) => i)),
    activeProposal: null,
    log: [],
    round: 0,
    phase: 'idle',
  };
}

function reducer(state: SimState, action: SimAction): SimState {
  switch (action.type) {
    case 'RESET':
      return initState(action.scenario);

    case 'HIGHLIGHT_PROPOSAL': {
      const pStates = [...state.proposerStates];
      const rStates = [...state.receiverStates];
      pStates[action.proposer] = 'proposing';
      rStates[action.receiver] = 'considering';
      return {
        ...state,
        proposerStates: pStates,
        receiverStates: rStates,
        activeProposal: { proposer: action.proposer, receiver: action.receiver },
      };
    }

    case 'CLEAR_HIGHLIGHT': {
      const pStates = state.proposerStates.map((s) =>
        s === 'proposing' ? 'idle' : s
      );
      const rStates = state.receiverStates.map((s, i) =>
        s === 'considering' ? (state.matches.has(i) ? 'matched' : 'idle') : s
      );
      return { ...state, proposerStates: pStates, receiverStates: rStates, activeProposal: null };
    }

    case 'STEP': {
      const { step } = action;
      const pStates = [...state.proposerStates];
      const rStates = [...state.receiverStates];
      const matches = new Map(state.matches);

      if (step.type === 'accept' || step.type === 'replace') {
        pStates[step.proposer] = 'matched';
        rStates[step.receiver] = 'matched';
        matches.set(step.receiver, step.proposer);
        if (step.type === 'replace' && step.replaced !== undefined) {
          pStates[step.replaced] = 'rejected';
        }
      } else {
        pStates[step.proposer] = 'rejected';
      }

      return {
        ...state,
        proposerStates: pStates,
        receiverStates: rStates,
        matches,
        log: [...state.log, step],
        round: step.round,
        activeProposal: null,
      };
    }

    case 'SET_PHASE':
      return { ...state, phase: action.phase };

    case 'MARK_DONE': {
      const pStates = state.proposerStates.map((s) =>
        s === 'rejected' ? 'matched' : s
      );
      return { ...state, phase: 'done', proposerStates: pStates };
    }

    default:
      return state;
  }
}

// --- Color helpers ---

function stateColor(s: PersonState): string {
  switch (s) {
    case 'proposing': return '#5e9ec2';
    case 'considering': return '#c49a6c';
    case 'matched': return '#d4a853';
    case 'rejected': return '#c86666';
    default: return '#8a8580';
  }
}

function rankColor(rank: number, total: number): string {
  const ratio = rank / total;
  if (ratio <= 0.3) return '#d4a853';
  if (ratio <= 0.6) return '#c49a6c';
  return '#c86666';
}

// --- Component ---

export const GaleShapleySimulator: React.FC = () => {
  const [proposalMode, setProposalMode] = useState<'men' | 'women'>('men');
  const [baseScenario, setBaseScenario] = useState(() => generateScenario());
  const scenario = useMemo(
    () => proposalMode === 'men'
      ? baseScenario
      : { label: baseScenario.label, proposers: baseScenario.receivers, receivers: baseScenario.proposers },
    [baseScenario, proposalMode]
  );
  const [state, dispatch] = useReducer(reducer, scenario, initState);

  const genRef = useRef<Generator<StepResult> | null>(null);
  const stopRef = useRef(false);
  const playingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [expandedPrefs, setExpandedPrefs] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [state.log.length]);

  useEffect(() => {
    genRef.current = galeShapley(scenario);
    dispatch({ type: 'RESET', scenario });
    stopRef.current = true;
    playingRef.current = false;
    setIsPlaying(false);
    setExpandedPrefs(null);
  }, [scenario]);

  const doStep = useCallback(async (): Promise<boolean> => {
    if (!genRef.current) return false;
    const result = genRef.current.next();
    if (result.done) {
      dispatch({ type: 'MARK_DONE' });
      return false;
    }

    const step = result.value;
    dispatch({ type: 'HIGHLIGHT_PROPOSAL', proposer: step.proposer, receiver: step.receiver });
    await new Promise((r) => setTimeout(r, 150));
    if (stopRef.current) return false;
    dispatch({ type: 'STEP', step });
    await new Promise((r) => setTimeout(r, 100));
    dispatch({ type: 'CLEAR_HIGHLIGHT' });
    return true;
  }, []);

  const handlePlay = useCallback(async () => {
    if (playingRef.current) {
      stopRef.current = true;
      playingRef.current = false;
      setIsPlaying(false);
      dispatch({ type: 'SET_PHASE', phase: 'idle' });
      return;
    }
    playingRef.current = true;
    setIsPlaying(true);
    stopRef.current = false;
    dispatch({ type: 'SET_PHASE', phase: 'running' });
    let hasMore = true;
    while (hasMore && !stopRef.current) {
      hasMore = await doStep();
    }
    playingRef.current = false;
    setIsPlaying(false);
    if (!stopRef.current) {
      dispatch({ type: 'SET_PHASE', phase: 'idle' });
    }
  }, [doStep]);

  const handleReset = useCallback(() => {
    stopRef.current = true;
    playingRef.current = false;
    setIsPlaying(false);
    setBaseScenario(generateScenario());
  }, []);

  const togglePrefs = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedPrefs((prev) => (prev === key ? null : key));
  };

  const n = scenario.proposers.length;
  const proposerLabel = proposalMode === 'men' ? 'Men' : 'Women';
  const receiverLabel = proposalMode === 'men' ? 'Women' : 'Men';
  const proposerSide: 'men' | 'women' = proposalMode === 'men' ? 'men' : 'women';
  const receiverSide: 'men' | 'women' = proposalMode === 'men' ? 'women' : 'men';

  const proposerMatch = (pIdx: number): number | undefined => {
    for (const [r, p] of state.matches.entries()) {
      if (p === pIdx) return r;
    }
    return undefined;
  };

  // Compute match quality stats
  const proposerAvgRank = (() => {
    if (state.matches.size === 0) return 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const matchR = proposerMatch(i);
      if (matchR !== undefined) total += scenario.proposers[i].preferences.indexOf(matchR) + 1;
    }
    return total / state.matches.size;
  })();

  const receiverAvgRank = (() => {
    if (state.matches.size === 0) return 0;
    let total = 0;
    state.matches.forEach((p, r) => {
      total += scenario.receivers[r].preferences.indexOf(p) + 1;
    });
    return total / state.matches.size;
  })();

  const menAvgRank = proposalMode === 'men' ? proposerAvgRank : receiverAvgRank;
  const womenAvgRank = proposalMode === 'men' ? receiverAvgRank : proposerAvgRank;

  // --- Render helpers ---

  const renderAvatar = (
    initial: string,
    personState: PersonState,
    side: 'men' | 'women',
    size: 'sm' | 'md' = 'md',
  ) => {
    const color = stateColor(personState);
    const dim = size === 'sm' ? 28 : 36;
    const fontSize = size === 'sm' ? 11 : 13;
    const isActive = personState !== 'idle';
    const ringGradient = side === 'men'
      ? 'linear-gradient(135deg, #c4915c, #d4a853)'
      : 'linear-gradient(135deg, #9a8abf, #b07aab)';

    return (
      <div className="gs-avatar" style={{ width: dim, height: dim }}>
        <div
          className="gs-avatar-ring"
          style={{ background: ringGradient, opacity: isActive ? 0.9 : 0.35 }}
        />
        <div
          className="gs-avatar-inner"
          style={{
            backgroundColor: isActive ? `${color}18` : 'var(--bg-primary)',
            boxShadow: isActive ? `0 0 12px ${color}50` : 'none',
            fontSize,
            color: isActive ? color : 'var(--text-secondary)',
          }}
        >
          {initial}
        </div>
      </div>
    );
  };

  return (
    <div className="gs-container">
      <style>{`
        /* Animations */
        @keyframes gs-slide-in {
          from { transform: translateX(-16px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes gs-pulse-glow {
          0%, 100% { box-shadow: 0 0 6px rgba(212,168,83,0.25); }
          50% { box-shadow: 0 0 14px rgba(212,168,83,0.5); }
        }
        .gs-badge-enter { animation: gs-slide-in 0.25s ease-out both; }
        .gs-match-glow { animation: gs-pulse-glow 2.5s ease-in-out infinite; }

        /* Container */
        .gs-container {
          position: relative;
          border: 1px solid var(--border);
          border-radius: 0.75rem;
          padding: 1.25rem;
          margin: 2rem 0;
          overflow: hidden;
          background:
            radial-gradient(ellipse at 15% 50%, rgba(196,145,92,0.05) 0%, transparent 60%),
            radial-gradient(ellipse at 85% 50%, rgba(154,138,191,0.05) 0%, transparent 60%),
            var(--bg-tertiary);
        }
        @media (min-width: 640px) {
          .gs-container { padding: 1.5rem; }
        }

        /* Controls */
        .gs-btn {
          padding: 0.5rem 0.875rem;
          font-size: 0.875rem;
          border-radius: 0.5rem;
          border: 1px solid var(--border);
          transition: all 0.15s;
          cursor: pointer;
        }
        .gs-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .gs-btn-secondary {
          background: var(--bg-secondary);
          color: var(--text-primary);
        }
        .gs-btn-secondary:hover:not(:disabled) {
          border-color: var(--accent);
        }
        .gs-btn-primary {
          border-color: var(--accent);
          color: var(--accent);
          background: transparent;
        }
        .gs-btn-primary:hover:not(:disabled) {
          background: var(--accent-subtle);
        }
        .gs-btn-muted {
          background: var(--bg-secondary);
          color: var(--text-secondary);
        }
        .gs-btn-muted:hover:not(:disabled) {
          color: var(--text-primary);
          border-color: var(--accent);
        }

        /* Column headers */
        .gs-col-header {
          height: 1.5rem;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-secondary);
          font-weight: 500;
          display: flex;
          align-items: flex-end;
          padding-bottom: 0.25rem;
        }

        /* Person rows (desktop) */
        .gs-person-row {
          height: 3rem;
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0 0.5rem;
          border-radius: 0.5rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        .gs-person-row:hover {
          background: var(--accent-subtle);
        }

        .gs-person-name {
          font-size: 0.9375rem;
          transition: color 0.3s;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }

        .gs-rank-badge {
          font-size: 0.75rem;
          font-family: monospace;
          font-weight: 700;
          flex-shrink: 0;
        }

        /* Middle column */
        .gs-center-line {
          position: absolute;
          left: 50%;
          transform: translateX(-0.5px);
          top: 28px;
          bottom: 4px;
        }
        .gs-center-line-inner {
          width: 1px;
          height: 100%;
          background: var(--border);
          opacity: 0.4;
        }
        .gs-mid-cell {
          height: 3rem;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }

        /* Mobile cards */
        .gs-mobile-card {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid var(--border);
          transition: all 0.3s;
          cursor: pointer;
        }

        /* Panels */
        .gs-panel {
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 0.5rem;
        }
        .gs-prefs-panel {
          margin-top: 0.75rem;
          padding: 0.625rem 0.875rem;
          font-size: 0.8125rem;
          color: var(--text-secondary);
        }
        .gs-quality-panel {
          margin-top: 1rem;
          padding: 1rem;
        }

        /* Progress bars */
        .gs-progress-track {
          height: 0.625rem;
          border-radius: 9999px;
          background: var(--bg-tertiary);
          overflow: hidden;
        }
        .gs-progress-fill {
          height: 100%;
          border-radius: 9999px;
        }

        /* Step log */
        .gs-log-section {
          margin-top: 1rem;
          border-top: 1px solid var(--border);
          padding-top: 0.75rem;
        }
        .gs-log-entries {
          max-height: 16rem;
          overflow-y: auto;
          font-size: 0.8125rem;
          font-family: monospace;
          line-height: 1.5;
        }
        .gs-log-entry {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
          padding: 0.25rem 0;
        }
        .gs-log-num {
          color: var(--text-secondary);
          width: 2rem;
          text-align: right;
          flex-shrink: 0;
        }
        .gs-log-dot {
          width: 0.375rem;
          height: 0.375rem;
          border-radius: 9999px;
          margin-top: 0.375rem;
          flex-shrink: 0;
        }

        /* Stats */
        .gs-stats {
          margin-top: 1rem;
          display: flex;
          flex-wrap: wrap;
          gap: 1.25rem;
          font-size: 0.8125rem;
          color: var(--text-secondary);
        }

        /* Legend */
        .gs-legend {
          display: flex;
          flex-wrap: wrap;
          gap: 1.25rem;
          margin-bottom: 1.25rem;
          font-size: 0.8125rem;
          color: var(--text-secondary);
        }
        .gs-legend-item {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }
        .gs-legend-dot {
          width: 0.625rem;
          height: 0.625rem;
          border-radius: 9999px;
          display: inline-block;
        }

        /* Avatar */
        .gs-avatar {
          position: relative;
          flex-shrink: 0;
          border-radius: 9999px;
        }
        .gs-avatar-ring {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          transition: opacity 0.3s;
        }
        .gs-avatar-inner {
          position: absolute;
          border-radius: 9999px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          transition: all 0.3s;
          inset: 2px;
        }
      `}</style>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div style={{ display: 'flex', borderRadius: '0.5rem', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <button
            onClick={() => setProposalMode('men')}
            className="gs-btn"
            style={{
              borderRadius: 0,
              border: 'none',
              borderRight: '1px solid var(--border)',
              background: proposalMode === 'men' ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
              color: proposalMode === 'men' ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            Men Propose
          </button>
          <button
            onClick={() => setProposalMode('women')}
            className="gs-btn"
            style={{
              borderRadius: 0,
              border: 'none',
              background: proposalMode === 'women' ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
              color: proposalMode === 'women' ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            Women Propose
          </button>
        </div>

        <div className="flex gap-2">
          <button onClick={handlePlay} disabled={state.phase === 'done'} className="gs-btn gs-btn-primary">
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button onClick={handleReset} className="gs-btn gs-btn-muted">
            Reset
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="gs-legend">
        {([
          ['Idle', '#8a8580'],
          ['Proposing', '#5e9ec2'],
          ['Considering', '#c49a6c'],
          ['Matched', '#d4a853'],
          ['Rejected', '#c86666'],
        ] as [string, string][]).map(([label, color]) => (
          <span key={label} className="gs-legend-item">
            <span className="gs-legend-dot" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>

      {/* === Three-column visualization (desktop) === */}
      {!isMobile ? (
        <div className="grid grid-cols-[1fr_72px_1fr] gap-x-3">
          {/* Men column */}
          <div className="flex flex-col gap-1">
            <div className="gs-col-header">{proposerLabel} (Proposers)</div>
            {scenario.proposers.map((p, i) => {
              const pState = state.proposerStates[i];
              const matchR = proposerMatch(i);
              const rank = matchR !== undefined ? p.preferences.indexOf(matchR) + 1 : null;
              return (
                <div
                  key={i}
                  className="gs-person-row"
                  onClick={(e) => togglePrefs(`p-${i}`, e)}
                  title={`Click to see ${p.name}'s preferences`}
                >
                  {renderAvatar(p.name[0], pState, proposerSide)}
                  <span className="gs-person-name" style={{ color: (pState === 'proposing' || pState === 'considering' || pState === 'rejected') ? stateColor(pState) : 'var(--text-primary)' }}>
                    {p.name}
                  </span>
                  {rank !== null && (
                    <span className="gs-rank-badge" style={{ color: rankColor(rank, n) }}>#{rank}</span>
                  )}
                </div>
              );
            })}
            <div style={{ textAlign: 'center', fontSize: '0.8125rem', color: proposerSide === 'men' ? '#c4915c' : '#9a8abf', marginTop: '0.25rem', fontWeight: 500 }}>
              {state.matches.size > 0 ? `Avg rank: #${(proposalMode === 'men' ? menAvgRank : womenAvgRank).toFixed(1)}` : '\u00A0'}
            </div>
          </div>

          {/* Middle proposal column */}
          <div className="flex flex-col gap-1 relative">
            <div className="h-6" />
            <div className="gs-center-line">
              <div className="gs-center-line-inner" />
            </div>
            {scenario.receivers.map((_, j) => {
              const activeHere = state.activeProposal?.receiver === j;
              const matchedP = state.matches.get(j);
              const showIdx = activeHere ? state.activeProposal!.proposer : matchedP;
              const isProposing = activeHere;
              const isMatched = !activeHere && matchedP !== undefined;

              return (
                <div key={j} className="gs-mid-cell">
                  {showIdx !== undefined && (isProposing || isMatched) && (
                    <div
                      key={`${showIdx}-${isProposing ? 'p' : 'm'}-${j}`}
                      className={`gs-badge-enter ${isMatched ? 'gs-match-glow' : ''}`}
                      style={{ borderRadius: '9999px' }}
                    >
                      {renderAvatar(scenario.proposers[showIdx].name[0], isProposing ? 'proposing' : 'matched', proposerSide, 'sm')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Women column */}
          <div className="flex flex-col gap-1">
            <div className="gs-col-header">{receiverLabel} (Receivers)</div>
            {scenario.receivers.map((r, j) => {
              const rState = state.receiverStates[j];
              const matchP = state.matches.get(j);
              const rank = matchP !== undefined ? r.preferences.indexOf(matchP) + 1 : null;
              return (
                <div
                  key={j}
                  className="gs-person-row"
                  onClick={(e) => togglePrefs(`r-${j}`, e)}
                  title={`Click to see ${r.name}'s preferences`}
                >
                  {renderAvatar(r.name[0], rState, receiverSide)}
                  <span className="gs-person-name" style={{ color: (rState === 'proposing' || rState === 'considering' || rState === 'rejected') ? stateColor(rState) : 'var(--text-primary)' }}>
                    {r.name}
                  </span>
                  {rank !== null && (
                    <span className="gs-rank-badge" style={{ color: rankColor(rank, n) }}>#{rank}</span>
                  )}
                </div>
              );
            })}
            <div style={{ textAlign: 'center', fontSize: '0.8125rem', color: receiverSide === 'women' ? '#9a8abf' : '#c4915c', marginTop: '0.25rem', fontWeight: 500 }}>
              {state.matches.size > 0 ? `Avg rank: #${(proposalMode === 'men' ? womenAvgRank : menAvgRank).toFixed(1)}` : '\u00A0'}
            </div>
          </div>
        </div>
      ) : (
        /* === Mobile stacked layout === */
        <div className="space-y-5">
          {/* Men */}
          <div>
            <div className="gs-col-header" style={{ marginBottom: '0.5rem' }}>{proposerLabel} (Proposers)</div>
            <div className="grid grid-cols-2 gap-2">
              {scenario.proposers.map((p, i) => {
                const pState = state.proposerStates[i];
                const matchR = proposerMatch(i);
                return (
                  <div
                    key={i}
                    className="gs-mobile-card"
                    style={{
                      borderColor: (pState === 'proposing' || pState === 'considering' || pState === 'rejected') ? stateColor(pState) : 'var(--border)',
                      backgroundColor: (pState === 'proposing' || pState === 'considering' || pState === 'rejected') ? `${stateColor(pState)}12` : 'transparent',
                    }}
                    onClick={(e) => togglePrefs(`p-${i}`, e)}
                  >
                    {renderAvatar(p.name[0], pState, proposerSide, 'sm')}
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: (pState === 'proposing' || pState === 'considering' || pState === 'rejected') ? stateColor(pState) : 'var(--text-primary)' }}>
                        {p.name}
                      </div>
                      {matchR !== undefined && (() => {
                        const rank = p.preferences.indexOf(matchR) + 1;
                        return <div className="text-xs" style={{ color: rankColor(rank, n) }}>{'\u2192'} {scenario.receivers[matchR].name} <span className="font-mono">#{rank}</span></div>;
                      })()}
                      {state.activeProposal?.proposer === i && (
                        <div className="text-xs" style={{ color: '#5e9ec2' }}>{'\u2192'} {scenario.receivers[state.activeProposal.receiver].name}?</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ textAlign: 'center', fontSize: '0.8125rem', color: proposerSide === 'men' ? '#c4915c' : '#9a8abf', marginTop: '0.375rem', fontWeight: 500 }}>
              {state.matches.size > 0 ? `Avg rank: #${(proposalMode === 'men' ? menAvgRank : womenAvgRank).toFixed(1)}` : '\u00A0'}
            </div>
          </div>
          {/* Women */}
          <div>
            <div className="gs-col-header" style={{ marginBottom: '0.5rem' }}>{receiverLabel} (Receivers)</div>
            <div className="grid grid-cols-2 gap-2">
              {scenario.receivers.map((r, j) => {
                const rState = state.receiverStates[j];
                const matchP = state.matches.get(j);
                return (
                  <div
                    key={j}
                    className="gs-mobile-card"
                    style={{
                      borderColor: (rState === 'proposing' || rState === 'considering' || rState === 'rejected') ? stateColor(rState) : 'var(--border)',
                      backgroundColor: (rState === 'proposing' || rState === 'considering' || rState === 'rejected') ? `${stateColor(rState)}12` : 'transparent',
                    }}
                    onClick={(e) => togglePrefs(`r-${j}`, e)}
                  >
                    {renderAvatar(r.name[0], rState, receiverSide, 'sm')}
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: (rState === 'proposing' || rState === 'considering' || rState === 'rejected') ? stateColor(rState) : 'var(--text-primary)' }}>
                        {r.name}
                      </div>
                      {matchP !== undefined && (() => {
                        const rank = r.preferences.indexOf(matchP) + 1;
                        return <div className="text-xs" style={{ color: rankColor(rank, n) }}>{'\u2190'} {scenario.proposers[matchP].name} <span className="font-mono">#{rank}</span></div>;
                      })()}
                      {state.activeProposal?.receiver === j && (
                        <div className="text-xs" style={{ color: '#c49a6c' }}>{'\u2190'} {scenario.proposers[state.activeProposal.proposer].name}?</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ textAlign: 'center', fontSize: '0.8125rem', color: receiverSide === 'women' ? '#9a8abf' : '#c4915c', marginTop: '0.375rem', fontWeight: 500 }}>
              {state.matches.size > 0 ? `Avg rank: #${(proposalMode === 'men' ? womenAvgRank : menAvgRank).toFixed(1)}` : '\u00A0'}
            </div>
          </div>
        </div>
      )}

      {/* Expanded preferences panel */}
      {expandedPrefs && (
        <div className="gs-panel gs-prefs-panel">
          {(() => {
            const [side, idxStr] = expandedPrefs.split('-');
            const idx = Number(idxStr);
            if (side === 'p') {
              const person = scenario.proposers[idx];
              return (
                <span>
                  <strong style={{ color: 'var(--text-primary)' }}>{person.name}</strong>&apos;s preferences:{' '}
                  {person.preferences.map((r, rank) => (
                    <span key={r}>
                      {rank > 0 && <span style={{ color: 'var(--text-tertiary)' }}> {'>'} </span>}
                      <span style={state.matches.get(r) === idx ? { color: 'var(--accent)', fontWeight: 500 } : undefined}>
                        {scenario.receivers[r].name}
                      </span>
                    </span>
                  ))}
                </span>
              );
            } else {
              const person = scenario.receivers[idx];
              return (
                <span>
                  <strong style={{ color: 'var(--text-primary)' }}>{person.name}</strong>&apos;s preferences:{' '}
                  {person.preferences.map((p, rank) => (
                    <span key={p}>
                      {rank > 0 && <span style={{ color: 'var(--text-tertiary)' }}> {'>'} </span>}
                      <span style={state.matches.get(idx) === p ? { color: 'var(--accent)', fontWeight: 500 } : undefined}>
                        {scenario.proposers[p].name}
                      </span>
                    </span>
                  ))}
                </span>
              );
            }
          })()}
        </div>
      )}

      {/* Stats bar */}
      <div className="gs-stats">
        <span>Proposals: {state.log.length}</span>
        <span>Matched: {state.matches.size}/{n}</span>
        <span>Rejections: {state.log.filter((l) => l.type === 'reject').length}</span>
        <span>Replacements: {state.log.filter((l) => l.type === 'replace').length}</span>
      </div>

      {/* Match Quality Comparison */}
        <div className="gs-panel gs-quality-panel">
          <div className="gs-col-header" style={{ marginBottom: '0.75rem' }}>Match Quality</div>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-[0.8125rem] mb-1">
                <span style={{ color: proposerSide === 'men' ? '#c4915c' : '#9a8abf' }}>{proposerLabel} (Proposers) — avg choice: <strong>{state.matches.size > 0 ? `#${proposerAvgRank.toFixed(1)}` : '—'}</strong></span>
                <span style={{ color: 'var(--text-secondary)' }}>{state.matches.size > 0 ? `${Math.round(((n + 1 - proposerAvgRank) / n) * 100)}% satisfaction` : ''}</span>
              </div>
              <div className="gs-progress-track">
                <div className="gs-progress-fill" style={{ width: state.matches.size > 0 ? `${((n + 1 - proposerAvgRank) / n) * 100}%` : '0%', background: proposerSide === 'men' ? 'linear-gradient(90deg, #c4915c, #d4a853)' : 'linear-gradient(90deg, #9a8abf, #b07aab)', transition: 'width 0.3s' }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[0.8125rem] mb-1">
                <span style={{ color: receiverSide === 'women' ? '#9a8abf' : '#c4915c' }}>{receiverLabel} (Receivers) — avg choice: <strong>{state.matches.size > 0 ? `#${receiverAvgRank.toFixed(1)}` : '—'}</strong></span>
                <span style={{ color: 'var(--text-secondary)' }}>{state.matches.size > 0 ? `${Math.round(((n + 1 - receiverAvgRank) / n) * 100)}% satisfaction` : ''}</span>
              </div>
              <div className="gs-progress-track">
                <div className="gs-progress-fill" style={{ width: state.matches.size > 0 ? `${((n + 1 - receiverAvgRank) / n) * 100}%` : '0%', background: receiverSide === 'women' ? 'linear-gradient(90deg, #9a8abf, #b07aab)' : 'linear-gradient(90deg, #c4915c, #d4a853)', transition: 'width 0.3s' }} />
              </div>
            </div>
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '0.75rem', lineHeight: 1.7 }}>
            {state.matches.size > 0
              ? <>The proposing side ({proposerLabel.toLowerCase()}) averages their <strong style={{ color: proposerSide === 'men' ? '#c4915c' : '#9a8abf' }}>#{proposerAvgRank.toFixed(1)}</strong> choice while the receiving side ({receiverLabel.toLowerCase()}) averages their <strong style={{ color: receiverSide === 'women' ? '#9a8abf' : '#c4915c' }}>#{receiverAvgRank.toFixed(1)}</strong> choice. This asymmetry is a fundamental property of the algorithm: proposers always get their best possible stable partner.</>
              : 'Run the simulation to see how match quality differs between proposers and receivers.'}
          </p>
        </div>

      {/* Counterfactual notice */}
      {state.phase === 'done' && proposerAvgRank > receiverAvgRank && (
        <div style={{
          marginTop: '0.75rem',
          padding: '0.75rem 1rem',
          borderRadius: '0.5rem',
          background: 'rgba(200, 102, 102, 0.08)',
          border: '1px solid rgba(200, 102, 102, 0.2)',
          fontSize: '0.8125rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
        }}>
          This run went against the theory — with only 10 people and random preferences, there&apos;s roughly a 17% chance the proposers end up with worse average ranks than the receivers. The gap is real but small at this scale. Hit <strong style={{ color: 'var(--text-primary)' }}>Reset</strong> to try again, or keep reading for the 100-person version where it&apos;s unmistakable.
        </div>
      )}

      {/* Step Log */}
        <div className="gs-log-section">
          <h4 className="text-xs font-medium mb-2 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Step Log {state.phase === 'done' && <span style={{ color: 'var(--accent)', textTransform: 'none' }}>(Complete!)</span>}
          </h4>
          <div className="gs-log-entries" ref={logRef}>
            {state.log.map((entry, i) => (
              <div key={i} className="gs-log-entry">
                <span className="gs-log-num">{i + 1}.</span>
                <span
                  className="gs-log-dot"
                  style={{
                    backgroundColor:
                      entry.type === 'accept' ? '#d4a853' :
                      entry.type === 'replace' ? '#c49a6c' :
                      '#c86666',
                  }}
                />
                <span style={{ color: 'var(--text-secondary)' }}>{entry.message}</span>
              </div>
            ))}
          </div>
        </div>
    </div>
  );
};
