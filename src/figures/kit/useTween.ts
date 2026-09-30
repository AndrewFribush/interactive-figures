'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DIM, LOSS } from '../figureTokens';
import { TWEEN_MS, easeOut, lerp } from './constants';

// A reader-caused change is a transition, not a cut: the hook follows a
// target value and returns the interpolated one, 300 ms cubic-out per frame
// (rAF), interruptible (a new target starts from wherever the tween is),
// and an instant cut under `prefers-reduced-motion`. `from`, `to`, `e`
// (eased progress) and the keys of both ends are exposed so a drawing can
// crossfade whatever it cannot interpolate. `cut()` marks the next change
// as one the reader did not cause (a shared link applied on load), so it
// lands without motion.

export interface TweenState<T> {
  /** The interpolated value: what the sheet draws this frame. */
  value: T;
  /** Where the running tween began (the value shown at the moment of change). */
  from: T;
  to: T;
  fromKey: unknown;
  toKey: unknown;
  /** Eased progress, 0 at the start, 1 at rest. */
  e: number;
  active: boolean;
  /** The next change lands as a cut, not a tween. */
  cut: () => void;
}

export interface TweenOptions<T> {
  ms?: number;
  /** Interpolator; defaults to numeric lerp. Use `mixRecord` for numeric records. */
  between?: (a: T, b: T, t: number) => T;
  /** Identity of the target (an id); without one, a change is detected by value. */
  key?: unknown;
}

interface Inner<T> {
  value: T;
  from: T;
  to: T;
  fromKey: unknown;
  toKey: unknown;
  sig: unknown;
  e: number;
  active: boolean;
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useTween<T>(target: T, opts: TweenOptions<T> = {}): TweenState<T> {
  const ms = opts.ms ?? TWEEN_MS;
  const between = opts.between ?? (lerp as unknown as (a: T, b: T, t: number) => T);
  const sig = opts.key !== undefined ? opts.key : JSON.stringify(target);
  const [st, setSt] = useState<Inner<T>>(() => ({
    value: target,
    from: target,
    to: target,
    fromKey: opts.key,
    toKey: opts.key,
    sig,
    e: 1,
    active: false,
  }));
  const stRef = useRef(st);
  stRef.current = st;
  const raf = useRef(0);
  const cutRef = useRef(false);
  const cut = useCallback(() => {
    cutRef.current = true;
  }, []);
  const latest = useRef({ target, key: opts.key, ms, between, sig });
  latest.current = { target, key: opts.key, ms, between, sig };

  // Layout effect, so the frame after a click never paints the new target
  // with the old value: the tween's first state lands before paint.
  useIsoLayoutEffect(() => {
    const cur = stRef.current;
    const { target: to, key, ms: dur, between: mixer, sig: s } = latest.current;
    if (s === cur.sig) return;
    cancelAnimationFrame(raf.current);
    const instant = cutRef.current || dur <= 0 || reducedMotion();
    cutRef.current = false;
    if (instant) {
      setSt({ value: to, from: to, to, fromKey: key, toKey: key, sig: s, e: 1, active: false });
      return;
    }
    const from = cur.value;
    const fromKey = cur.toKey;
    setSt({ value: from, from, to, fromKey, toKey: key, sig: s, e: 0, active: true });
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = easeOut(t);
      if (t < 1) {
        setSt({ value: mixer(from, to, e), from, to, fromKey, toKey: key, sig: s, e, active: true });
        raf.current = requestAnimationFrame(frame);
      } else setSt({ value: to, from: to, to, fromKey: key, toKey: key, sig: s, e: 1, active: false });
    };
    raf.current = requestAnimationFrame(frame);
  }, [sig]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return { value: st.value, from: st.from, to: st.to, fromKey: st.fromKey, toKey: st.toKey, e: st.e, active: st.active, cut };
}

/** Interpolate every number in a record (the `mix` pattern). */
export function mixRecord<K extends string>(a: Record<K, number>, b: Record<K, number>, t: number): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of Object.keys(b) as K[]) out[k] = lerp(a[k], b[k], t);
  return out;
}

/** A one-hot record: 1 for the chosen key, 0 for every other. */
export function oneHot<K extends string>(keys: readonly K[], chosen: K): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = k === chosen ? 1 : 0;
  return out;
}

/** The chosen-one crossfade: a one-hot record over `keys`, tweened when `chosen` changes. */
export function useMix<K extends string>(keys: readonly K[], chosen: K, ms?: number): TweenState<Record<K, number>> {
  return useTween(oneHot(keys, chosen), { ms, between: mixRecord, key: chosen });
}

export interface CrossfadeLayer {
  color: string;
  opacity: number;
  /** true for the accent layer, false for the grey one. */
  on: boolean;
}

/**
 * Colour crossfade without interpolating colour: draw the mark twice, grey
 * fading out and accent fading in, at opacities that sum to one. Layers at
 * zero opacity are dropped, so at rest one mark is drawn.
 */
export function crossfade(t: number, off: string = DIM, on: string = LOSS): CrossfadeLayer[] {
  const layers: CrossfadeLayer[] = [
    { color: off, opacity: 1 - t, on: false },
    { color: on, opacity: t, on: true },
  ];
  return layers.filter((l) => l.opacity > 0);
}
