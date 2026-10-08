/** An axis-aligned node rectangle in flow coordinates. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Horizontal distance an edge travels away from a handle before it turns. */
export const LOOP_STUB = 20;
/** Gap between the lowest obstacle and the first loop-back lane. */
export const LOOP_CLEARANCE = 28;
/** Spacing between stacked loop-back lanes. */
export const LOOP_LANE_GAP = 26;
const CORNER_RADIUS = 10;

/**
 * Whether an edge between the given handle points runs backward (against the left-to-right
 * flow) and therefore needs to be routed around the nodes between its endpoints.
 *
 * @param sourceX the x coordinate of the source handle
 * @param targetX the x coordinate of the target handle
 * @returns true when the target lies left of the source
 */
export function isLoopBack(sourceX: number, targetX: number): boolean {
  return targetX < sourceX + LOOP_STUB;
}

/**
 * Compute the y coordinate of the horizontal lane a loop-back edge travels along: below every
 * obstacle that overlaps its horizontal span, pushed further down by one lane per nested
 * loop-back so stacked loops do not overlap.
 *
 * @param minX the left edge of the span the loop covers
 * @param maxX the right edge of the span the loop covers
 * @param floorY the lowest point of the loop's own endpoints
 * @param obstacles node boxes that the lane must clear
 * @param nestedCount the number of other loop-backs nested inside this one
 * @returns the lane y coordinate
 */
export function loopLaneY(
  minX: number,
  maxX: number,
  floorY: number,
  obstacles: Box[],
  nestedCount: number,
): number {
  const bottom = obstacles
    .filter(box => box.x < maxX && box.x + box.width > minX)
    .reduce((lowest, box) => Math.max(lowest, box.y + box.height), floorY);
  return bottom + LOOP_CLEARANCE + nestedCount * LOOP_LANE_GAP;
}

/**
 * Build an orthogonal SVG path with rounded corners through the given points.
 *
 * @param points the polyline vertices, in order
 * @returns an SVG path string
 */
export function roundedPolyline(points: { x: number; y: number }[]): string {
  let path = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const r = Math.min(
      CORNER_RADIUS,
      Math.hypot(curr.x - prev.x, curr.y - prev.y) / 2,
      Math.hypot(next.x - curr.x, next.y - curr.y) / 2,
    );
    const inX = curr.x - Math.sign(curr.x - prev.x) * r;
    const inY = curr.y - Math.sign(curr.y - prev.y) * r;
    const outX = curr.x + Math.sign(next.x - curr.x) * r;
    const outY = curr.y + Math.sign(next.y - curr.y) * r;
    path += ` L ${inX},${inY} Q ${curr.x},${curr.y} ${outX},${outY}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x},${last.y}`;
}

/**
 * Route a loop-back edge from a right-side source handle to a left-side target handle: out to
 * the right, down to the lane, left beneath the intervening nodes, then up and into the target.
 *
 * @param sourceX the source handle x
 * @param sourceY the source handle y
 * @param targetX the target handle x
 * @param targetY the target handle y
 * @param laneY the lane y coordinate (see {@link loopLaneY})
 * @returns the SVG path and a label anchor centred on the lane
 */
export function loopBackPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  laneY: number,
): [path: string, labelX: number, labelY: number] {
  const right = sourceX + LOOP_STUB;
  const left = targetX - LOOP_STUB;
  const path = roundedPolyline([
    { x: sourceX, y: sourceY },
    { x: right, y: sourceY },
    { x: right, y: laneY },
    { x: left, y: laneY },
    { x: left, y: targetY },
    { x: targetX, y: targetY },
  ]);
  return [path, (left + right) / 2, laneY];
}
