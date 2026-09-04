import { getNodesBounds, getViewportForBounds, type Node } from '@xyflow/react';
import { toPng } from 'html-to-image';
import { triggerDownload } from './workflowIo.ts';

/** Fixed pixel dimensions of the exported PNG. */
const IMAGE_WIDTH = 1600;
const IMAGE_HEIGHT = 1000;
/** Fraction of the image reserved as empty margin around the graph. */
const IMAGE_PADDING = 0.1;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;

/**
 * Renders the workflow canvas to a PNG and triggers a download.
 *
 * The viewport is framed to the graph's bounds so the exported image captures the
 * whole workflow regardless of the current pan/zoom. No-ops when there is nothing
 * to export (no nodes or no rendered canvas).
 */
export async function exportCanvasImage(
  nodes: Node[],
  fileName: string,
  backgroundColor: string,
): Promise<void> {
  const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewportEl || nodes.length === 0) return;

  const bounds = getNodesBounds(nodes);
  const viewport = getViewportForBounds(bounds, IMAGE_WIDTH, IMAGE_HEIGHT, MIN_ZOOM, MAX_ZOOM, IMAGE_PADDING);

  const dataUrl = await toPng(viewportEl, {
    backgroundColor,
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    style: {
      width: `${IMAGE_WIDTH}px`,
      height: `${IMAGE_HEIGHT}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
  });

  triggerDownload(fileName, dataUrl);
}
