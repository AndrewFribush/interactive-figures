'use client';

// Prose↔figure linking (the Distill/Ciechanowski move): a tiny highlight
// channel registry. Inline <FigRef id> spans publish hover/focus; figures
// subscribe to ids they know how to emphasize. No context provider needed ·
// the channel is module-global, which is correct here: a term in the essay
// should light up the figure wherever it is on the page.

const channels = new Map<string, Set<(on: boolean) => void>>();

export const HIGHLIGHT_CHANNELS = [
  'odyssey-flagship',
  'odyssey-laestrygonians',
  'odyssey-calypso',
] as const;

export type HighlightChannel = (typeof HIGHLIGHT_CHANNELS)[number];

export const setHighlight = (id: HighlightChannel, on: boolean): void => {
  channels.get(id)?.forEach((cb) => cb(on));
};

export const subscribeHighlight = (id: HighlightChannel, cb: (on: boolean) => void): (() => void) => {
  let subs = channels.get(id);
  if (!subs) channels.set(id, (subs = new Set()));
  subs.add(cb);
  return () => {
    subs.delete(cb);
    if (subs.size === 0) channels.delete(id);
  };
};
