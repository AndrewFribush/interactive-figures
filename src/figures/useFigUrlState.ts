import { useCallback, useRef, useState } from 'react';

// Shareable figure state: any figure can mirror a piece of its state into
// the URL query string (replaceState, no navigation, debounced), so a
// specific view of an instrument is a copyable link · on plates, in
// context, and inside embeds alike. Keys are namespaced by the caller
// (e.g. `f0117_t`) so several figures can share one page.
export function useFigUrlState(key: string): [string | null, (v: string | null) => void] {
  const [initial] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(key),
  );
  // Throttle with a guaranteed trailing write (a plain debounce starves
  // forever under per-frame callers like a playing figure).
  const timer = useRef(0);
  const lastWrite = useRef(0);
  const pending = useRef<string | null | undefined>(undefined);
  const write = useCallback(
    (v: string | null) => {
      pending.current = v;
      const flush = () => {
        lastWrite.current = performance.now();
        const p = pending.current;
        pending.current = undefined;
        if (p === undefined) return;
        const sp = new URLSearchParams(window.location.search);
        if (p == null || p === '') sp.delete(key);
        else sp.set(key, p);
        const q = sp.toString();
        window.history.replaceState(null, '', q ? `${window.location.pathname}?${q}` : window.location.pathname);
      };
      const since = performance.now() - lastWrite.current;
      window.clearTimeout(timer.current);
      if (since >= 300) flush();
      else timer.current = window.setTimeout(flush, 300 - since);
    },
    [key],
  );
  return [initial, write];
}

/** Namespace a param key for a figure number: fig 0.1.17 + "t" → f0117_t. */
export function figParamKey(number: string, param: string): string {
  return `f${number.replace(/\./g, '')}_${param}`;
}
