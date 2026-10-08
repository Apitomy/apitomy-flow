import { type CSSProperties } from 'react';

/** Stroke colour for loop-back edges; matches the badge's loop icon. */
export const LOOP_BACK_COLOR = 'var(--flow-loop-back, #8476d1)';
/** Stroke colour for the selected edge. */
export const SELECTED_COLOR = 'var(--pf-t--global--color--brand--default, #06c)';

/** Stroke overrides applied while simulating. */
export interface SimEdgeStyle {
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  strokeDasharray?: string;
}

/** Inputs that decide how an edge's line is drawn. */
export interface EdgeStyleInput {
  /** Style from the host component (e.g. the viewer's executed-path styling). */
  hostStyle?: CSSProperties;
  sim?: SimEdgeStyle;
  selected?: boolean;
  loopBack?: boolean;
  isTimeout?: boolean;
}

/**
 * Resolve an edge's line style. Precedence, highest first: simulation outcome, selection,
 * the host's style, loop-back tint, then defaults. Host values are only replaced when a
 * higher-precedence source actually sets them.
 *
 * @param input the competing style sources
 * @returns the style to apply to the edge path
 */
export function resolveEdgeStyle(input: EdgeStyleInput): CSSProperties {
  const { hostStyle, sim, selected, loopBack, isTimeout } = input;
  const host = hostStyle ?? {};
  return {
    ...host,
    strokeWidth: sim?.strokeWidth ?? (selected ? 2.5 : undefined) ?? host.strokeWidth ?? 1.5,
    stroke: sim?.stroke ?? (selected ? SELECTED_COLOR : undefined) ?? host.stroke
      ?? (loopBack ? LOOP_BACK_COLOR : undefined),
    opacity: sim?.opacity ?? (selected ? 1 : undefined) ?? host.opacity,
    strokeDasharray: sim?.strokeDasharray ?? host.strokeDasharray ?? (isTimeout ? '6 4' : undefined),
  };
}
