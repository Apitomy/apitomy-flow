import { useCallback, useRef, useState } from 'react';
import { type Node, type Edge } from '@xyflow/react';

interface Snapshot<NodeData extends Record<string, unknown> = Record<string, unknown>> {
  nodes: Node<NodeData>[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

function cloneSnapshot<NodeData extends Record<string, unknown>>(
  nodes: Node<NodeData>[],
  edges: Edge[],
): Snapshot<NodeData> {
  return {
    nodes: JSON.parse(JSON.stringify(nodes)),
    edges: JSON.parse(JSON.stringify(edges)),
  };
}

export function useUndoRedo<NodeData extends Record<string, unknown> = Record<string, unknown>>() {
  const historyRef = useRef<Snapshot<NodeData>[]>([]);
  const pointerRef = useRef(-1);
  const [, rerender] = useState(0);

  const canUndo = pointerRef.current > 0;
  const canRedo = pointerRef.current < historyRef.current.length - 1;

  const takeSnapshot = useCallback((nodes: Node<NodeData>[], edges: Edge[]) => {
    historyRef.current = historyRef.current.slice(0, pointerRef.current + 1);
    historyRef.current.push(cloneSnapshot(nodes, edges));
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current = historyRef.current.slice(historyRef.current.length - MAX_HISTORY);
    }
    pointerRef.current = historyRef.current.length - 1;
    rerender(c => c + 1);
  }, []);

  const undo = useCallback((): Snapshot<NodeData> | null => {
    if (pointerRef.current <= 0) return null;
    pointerRef.current -= 1;
    rerender(c => c + 1);
    const snapshot = historyRef.current[pointerRef.current];
    return cloneSnapshot(snapshot.nodes, snapshot.edges);
  }, []);

  const redo = useCallback((): Snapshot<NodeData> | null => {
    if (pointerRef.current >= historyRef.current.length - 1) return null;
    pointerRef.current += 1;
    rerender(c => c + 1);
    const snapshot = historyRef.current[pointerRef.current];
    return cloneSnapshot(snapshot.nodes, snapshot.edges);
  }, []);

  return { takeSnapshot, undo, redo, canUndo, canRedo };
}
