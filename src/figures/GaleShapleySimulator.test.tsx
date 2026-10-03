// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GaleShapleySimulator } from './GaleShapleySimulator';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('stable matching completion', () => {
  it('keeps the finished result complete after the playback loop returns', async () => {
    vi.useFakeTimers();
    // Identical strict rankings exercise rejections and replacements while
    // keeping the example repeatable. The real generator and reducer run.
    vi.spyOn(Math, 'random').mockReturnValue(0.4);
    const { container } = render(<GaleShapleySimulator />);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(container.querySelector('.gs-stats')?.textContent).toContain('Matched: 10/10');
    expect(screen.getByText('(Complete!)')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByText('(Complete!)')).toBeTruthy();
  });
});
