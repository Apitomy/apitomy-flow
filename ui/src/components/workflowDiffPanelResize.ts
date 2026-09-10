/**
 * Clamp the detail panel width while dragging its resize handle.
 */
export function clampDetailPanelWidth(startWidth: number, startX: number, currentX: number): number {
  const nextWidth = startWidth + (startX - currentX);
  return Math.max(200, Math.min(600, nextWidth));
}
