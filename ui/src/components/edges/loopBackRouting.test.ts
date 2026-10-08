import { describe, it, expect } from 'vitest';
import { isLoopBack, loopLaneY, loopBackPath, LOOP_CLEARANCE, LOOP_LANE_GAP } from './loopBackRouting.ts';

describe('loopBackRouting', () => {
  it('treats only target-left-of-source edges as loop-backs', () => {
    expect(isLoopBack(100, 300)).toBe(false);
    expect(isLoopBack(300, 100)).toBe(true);
  });

  it('places the lane below every node the span overlaps, ignoring nodes outside it', () => {
    const boxes = [
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 150, y: 80, width: 100, height: 50 },
      { x: 600, y: 900, width: 100, height: 50 },
    ];
    expect(loopLaneY(50, 300, 25, boxes, 0)).toBe(130 + LOOP_CLEARANCE);
  });

  it('pushes nested loops onto separate lanes', () => {
    const boxes = [{ x: 0, y: 0, width: 100, height: 50 }];
    expect(loopLaneY(0, 100, 25, boxes, 2) - loopLaneY(0, 100, 25, boxes, 0)).toBe(2 * LOOP_LANE_GAP);
  });

  it('routes from source to target via the lane and labels the lane', () => {
    const [path, labelX, labelY] = loopBackPath(400, 25, 100, 25, 200);
    expect(path.startsWith('M 400,25')).toBe(true);
    expect(path.endsWith('L 100,25')).toBe(true);
    expect(labelY).toBe(200);
    expect(labelX).toBe(250);
  });
});
