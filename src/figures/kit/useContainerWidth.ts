import { useEffect, useRef, useState } from 'react';

// The measured width of a figure's wrapper, so the viewBox can follow the
// container and type is drawn at the same pixel size on a phone as on a
// desktop. Before the first measurement the width is `initial` (the SSR
// width), unless a server-side renderer has set `globalThis.__FIG_WIDTH__`
// to lay the figure out at a chosen width with no browser at all; that
// global is read once, at first render, and never again.

const MIN_WIDTH = 280;

export function chosenWidth(initial: number, min = MIN_WIDTH): number {
  const g = (globalThis as { __FIG_WIDTH__?: unknown }).__FIG_WIDTH__;
  return typeof g === 'number' && Number.isFinite(g) ? Math.max(min, Math.round(g)) : initial;
}

export function useContainerWidth<T extends HTMLElement = HTMLDivElement>(
  initial: number,
  min = MIN_WIDTH,
): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(() => chosenWidth(initial, min));
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setW(Math.max(min, Math.round(el.getBoundingClientRect().width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, w];
}
