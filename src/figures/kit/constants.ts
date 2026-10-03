// The shared type metrics and small helpers every figure drew for itself.
// One definition here, so a build agent writes only the drawing.

/** The one type size on a sheet: never smaller, on a phone or a desktop. */
export const FS = 12;
/** Geist Mono advance at FS, close enough to place and wrap labels. */
export const CH = FS * 0.62;
/** Baseline pitch for stacked mono rows. */
export const LINE = FS + 3;
/** A reader-caused change tweens this long, cubic-out. */
export const TWEEN_MS = 300;
/** Serif for quoted or Greek text inside a sheet. */
export const SERIF = 'var(--font-source-serif), Georgia, serif';
/** Serif advance ratio (per px of font size) for wrapping quoted text. */
export const SERIF_CH = 0.5;

export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
export const upper = (s: string) => s.toUpperCase();

/** Greedy word wrap at a fixed advance: rows that fit in maxPx at ch px per character. */
export function wrapText(text: string, maxPx: number, ch: number): string[] {
  const max = Math.max(8, Math.floor(maxPx / ch));
  const words = text.split(' ');
  const rows: string[] = [];
  let cur = '';
  for (const wd of words) {
    const next = cur ? `${cur} ${wd}` : wd;
    if (next.length > max && cur) {
      rows.push(cur);
      cur = wd;
    } else cur = next;
  }
  if (cur) rows.push(cur);
  return rows;
}

/** Wrap mono text to a pixel width at a font size (FS by default). */
export const wrapMono = (text: string, maxPx: number, fontSize = FS) => wrapText(text, maxPx, fontSize * 0.62);

/** Wrap serif (quoted, Greek) text to a pixel width at a font size. */
export const wrapSerif = (text: string, maxPx: number, fontSize: number) => wrapText(text, maxPx, fontSize * SERIF_CH);
