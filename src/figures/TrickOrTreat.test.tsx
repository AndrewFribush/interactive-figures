// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TrickOrTreat from './TrickOrTreat';

let measuredWidth = 600;
const resizeCallbacks = new Set<() => void>();

// jsdom has no layout or ResizeObserver. Keep the component, town generator,
// planners, and interactions real; supply only the browser's measured width.
class ControlledResizeObserver implements ResizeObserver {
  private readonly notify: () => void;

  constructor(callback: ResizeObserverCallback) {
    this.notify = () => callback([], this);
  }

  observe() { resizeCallbacks.add(this.notify); }
  unobserve() { resizeCallbacks.delete(this.notify); }
  disconnect() { resizeCallbacks.delete(this.notify); }
}

function resize(width: number) {
  act(() => {
    measuredWidth = width;
    for (const notify of resizeCallbacks) notify();
  });
}

function houses() {
  return screen.getAllByRole('button', { name: /candy\./i });
}

function title() {
  return screen.getByRole('group').getAttribute('aria-label') ?? '';
}

function sheetText() {
  return [...screen.getByRole('group').querySelectorAll('text')].map((node) => node.textContent).join(' ');
}

beforeEach(() => {
  measuredWidth = 600;
  resizeCallbacks.clear();
  vi.stubGlobal('ResizeObserver', ControlledResizeObserver);
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: true,
    media,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
  }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0, y: 0, width: measuredWidth, height: 600,
    top: 0, right: measuredWidth, bottom: 600, left: 0,
    toJSON() { return {}; },
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TrickOrTreat town changes', () => {
  it('keeps the figure usable when a selected desktop-only house disappears on resize', () => {
    render(<TrickOrTreat seed={78} />);
    // Seed 78: house 16 is reachable (12 minutes); compact has only 14 houses.
    fireEvent.click(houses()[16]);
    expect(screen.getByRole('button', { name: /your stop 1; press to remove/i })).toBeTruthy();

    expect(() => resize(390)).not.toThrow();
    expect(houses()).toHaveLength(14);
    expect(screen.queryByRole('button', { name: /your stop/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /race every walker/i }));
    expect(title()).toMatch(/candy/i);
    expect(title()).not.toMatch(/^minute\s/i);
  });

  it('discards a focused house when resizing to a town without that house', () => {
    render(<TrickOrTreat seed={78} />);
    fireEvent.focus(houses()[16]);
    expect(sheetText()).toMatch(/click to add/i);

    expect(() => resize(390)).not.toThrow();
    expect(houses()).toHaveLength(14);
    expect(sheetText()).not.toMatch(/click to add/i);
  });

  it('discards a rejected house before the smaller town renders', () => {
    render(<TrickOrTreat seed={78} />);
    // House 14 needs 38 minutes on this board, beyond its 35-minute curfew.
    fireEvent.click(houses()[14]);
    expect(screen.getByText(/not added:/i, { selector: 'p' })).toBeTruthy();

    expect(() => resize(390)).not.toThrow();
    expect(houses()).toHaveLength(14);
    expect(screen.queryByText(/not added:/i, { selector: 'p' })).toBeNull();
  });

  it('clears the rejected-house announcement when generating a neighborhood', () => {
    render(<TrickOrTreat seed={78} />);
    fireEvent.click(houses()[14]);
    expect(screen.getByText(/not added:/i, { selector: 'p' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /generate a new neighbou?rhood/i }));
    expect(screen.queryByText(/not added:/i, { selector: 'p' })).toBeNull();
    expect(screen.queryByRole('button', { name: /your stop/i })).toBeNull();
    expect(title()).toMatch(/houses/i);
  });

  it('starts a measured phone layout mid-race, including Strict Mode effect replay', () => {
    measuredWidth = 390;
    render(<StrictMode><TrickOrTreat seed={78} /></StrictMode>);

    expect(houses()).toHaveLength(14);
    const clock = title().match(/(\d+)(?: of |\/)(\d+)/i);
    expect(clock).not.toBeNull();
    expect(Number(clock![1])).toBeGreaterThan(0);
    expect(Number(clock![1])).toBeLessThan(Number(clock![2]));
    expect(screen.getByRole('button', { name: /race every walker/i })).toBeTruthy();
  });
});
