import { describe, it, expect } from 'vitest';
import { resolveEdgeStyle, LOOP_BACK_COLOR, SELECTED_COLOR } from './edgeStyle.ts';

const EXECUTED = { stroke: 'darkgreen', strokeWidth: 2.5, opacity: 1 };

describe('resolveEdgeStyle', () => {
  it('keeps the host (viewer executed-path) styling instead of discarding it', () => {
    expect(resolveEdgeStyle({ hostStyle: EXECUTED })).toMatchObject(EXECUTED);
  });

  it('keeps host dimming for edges that were not executed', () => {
    expect(resolveEdgeStyle({ hostStyle: { strokeWidth: 1, opacity: 0.3 } }))
      .toMatchObject({ strokeWidth: 1, opacity: 0.3 });
  });

  it('colours executed loop-backs with the executed colour, not the loop tint', () => {
    expect(resolveEdgeStyle({ hostStyle: EXECUTED, loopBack: true }).stroke).toBe(EXECUTED.stroke);
  });

  it('tints loop-backs when nothing else sets a colour', () => {
    expect(resolveEdgeStyle({ loopBack: true }).stroke).toBe(LOOP_BACK_COLOR);
  });

  it('lets selection and then simulation override the host', () => {
    expect(resolveEdgeStyle({ hostStyle: EXECUTED, selected: true }).stroke).toBe(SELECTED_COLOR);
    expect(resolveEdgeStyle({ hostStyle: EXECUTED, selected: true, sim: { stroke: 'red' } }).stroke).toBe('red');
  });

  it('defaults to a plain line', () => {
    expect(resolveEdgeStyle({})).toMatchObject({ strokeWidth: 1.5, stroke: undefined, opacity: undefined });
  });
});
