import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const figures = [
  {
    id: 'trick-or-treat', number: '1.1.15', title: 'Trick-or-treat routes',
    topic: 'Combinatorial optimization',
    summary: 'Five route planners race through the same seeded suburb. Collect the most candy and get home before curfew.',
    tryIt: 'Click houses to plan your own route, press GO to race, then select a planner and step through its decisions. NEW NEIGHBOURHOOD creates a fresh problem.',
    method: 'Nearest-neighbor and candy-per-minute greedy routes compete with 2-opt, simulated annealing, and branch-and-bound search. Every route includes the trip home. Exact search reports whether it proved optimality or reached its node cap.',
    source: 'Generated suburb and rewards; no external data.',
    image: 'trick-or-treat.jpg',
    Component: lazy(() => import('./figures/TrickOrTreat')),
  },
  {
    id: 'stable-matching', number: '2.1.1', title: 'Stable matching',
    topic: 'Gale–Shapley algorithm',
    summary: 'Watch proposals, rejections, and replacements resolve into a stable matching. Switch which side proposes with the same preferences.',
    tryIt: 'Press Play to run the matching. Expand preferences to inspect individual rankings. Switch the proposing side to compare outcomes; Reset generates fresh preferences.',
    method: 'A generator yields each deferred-acceptance decision; a reducer updates the people, matches, and event log. A receiver keeps the preferred proposal so far. Stability is a property of the preference lists, not a claim that everyone gets a first choice.',
    source: 'Synthetic, randomly shuffled complete preference lists for two groups of ten.',
    image: 'stable-matching.jpg', thumbnail: 'stable-matching-thumb.jpg',
    Component: lazy(() => import('./figures/GaleShapleySimulator').then((m) => ({ default: m.GaleShapleySimulator }))),
  },
  {
    id: 'job-search', number: '1.1.12', title: 'A thousand job searches',
    topic: 'Monte Carlo simulation',
    summary: 'Change application volume, interview rate, and offer rate to see the distribution of time spent searching.',
    tryIt: 'Move the three sliders and compare the median with the long tail. RUN AGAIN draws another thousand searches at the same odds.',
    method: 'For a applications per week, interview probability i, and offer probability o, the weekly success probability is 1 − (1 − i·o)^a. Seeded geometric draws stop at 78 weeks. This is an illustrative model with independent, constant odds, not an individual forecast.',
    source: 'BLS median-duration series UEMPMED via FRED, snapshot through July 2026; simulated searches are synthetic.',
    image: 'job-search.jpg',
    Component: lazy(() => import('./figures/SearchSimulator')),
  },
  {
    id: 'odyssey', number: '1.1.2', title: 'The return from Troy',
    topic: 'Narrative cartography',
    summary: 'A Minard-style flow map of the Odyssey: twelve ships and 600 men leave Troy; one man reaches home.',
    tryIt: 'Play the return, move between stops, or drag the voyage timeline. The band narrows at each loss; the ship muster and elapsed years follow the same clock.',
    method: 'A custom SVG band encodes men remaining over a compiled Mediterranean coastline. The schedule combines travel distance with story-time stays. The route follows traditional identifications of mythical places, not a historical reconstruction.',
    source: 'Homer’s Odyssey and ship accounting; Natural Earth 10m public-domain coastline.',
    image: 'odyssey.jpg', thumbnail: 'odyssey-thumb.jpg',
    Component: lazy(() => import('./figures/OdysseyReturn')),
  },
] as const;

function App() {
  const selectedId = new URLSearchParams(window.location.search).get('figure');
  const selected = figures.find((f) => f.id === selectedId);
  if (selected) document.title = `${selected.title} · Interactive figures`;
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header">
      <a href="./">Interactive figures</a>
      <a href="https://www.andrewfribush.com">Andrew Fribush ↗</a>
    </header>
    <main id="main">
      {selected ? <>
        <a className="back-link" href="./">← All four figures</a>
        <div className="intro">
          <p className="eyebrow">{selected.topic}</p>
          <h1>{selected.title}</h1>
          <p>{selected.summary}</p>
          <a href={`https://www.andrewfribush.com/fig/${selected.number}`}>Original live figure ↗</a>
        </div>
        <figure>
          <figcaption>fig. {selected.number} · {selected.title.toLowerCase()}</figcaption>
          <div className={`figure-sheet figure-${selected.id}`}>
            <Suspense fallback={<p className="loading" role="status">Loading figure…</p>}>
              <selected.Component />
            </Suspense>
          </div>
        </figure>
        <section className="notes" aria-label="Figure notes">
          <h2>Try it</h2>
          <p>{selected.tryIt}</p>
          <h2>How it works</h2>
          <p>{selected.method}</p>
          <p className="source">Source: {selected.source}</p>
        </section>
        <nav className="figure-nav" aria-label="Other figures">
          {figures.filter((f) => f.id !== selected.id).map((f) => <a key={f.id} href={`?figure=${f.id}`}>{f.title} →</a>)}
        </nav>
      </> : <>
        <div className="intro">
          <p className="eyebrow">Andrew Fribush · selected work</p>
          <h1>{selectedId ? 'Figure not found' : 'Interactive figures'}</h1>
          <p>Four small, working explanations of algorithms and data. Play with the inputs, follow the decisions, and read the code.</p>
        </div>
        <ol className="gallery">
          {figures.map((f) => <li key={f.id}>
            <a href={`?figure=${f.id}`} className="preview" aria-label={`Open ${f.title}`}>
              <img src={`./screenshots/${'thumbnail' in f ? f.thumbnail : f.image}`} alt="" width="760" height="560" />
            </a>
            <div>
              <p className="eyebrow">fig. {f.number} · {f.topic}</p>
              <h2><a href={`?figure=${f.id}`}>{f.title}</a></h2>
              <p>{f.summary}</p>
              <div className="gallery-links">
                <a href={`?figure=${f.id}`}>Explore figure →</a>
                <a href={`https://www.andrewfribush.com/fig/${f.number}`}>Original ↗</a>
              </div>
            </div>
          </li>)}
        </ol>
      </>}
    </main>
    <footer>By <a href="https://www.andrewfribush.com">Andrew Fribush</a>. React, TypeScript, and SVG. Runs in your browser.</footer>
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
