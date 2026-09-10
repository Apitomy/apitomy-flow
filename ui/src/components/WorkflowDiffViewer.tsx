import { useMemo, useState, useCallback, useRef, type JSX } from 'react';
import { ReactFlow, Background, Controls, ReactFlowProvider, type Node, type Edge } from '@xyflow/react';
import { type Workflow } from '../types/workflow.ts';
import { type FlowTheme } from './WorkflowEditor.tsx';
import { nodeTypes } from './nodes/nodeTypes.ts';
import { edgeTypes } from './edges/edgeTypes.ts';
import { toReactFlowNodes, toReactFlowEdges } from '../utils/conversion.ts';
import { needsLayout, layoutWorkflow } from '../layout/layoutWorkflow.ts';
import { diffWorkflows, resolveWorkflowLabel } from '../diff/workflowDiff.ts';
import { buildDiffRenderModel } from '../diff/buildDiffRenderModel.ts';
import { type DiffStatus } from '../diff/workflowDiffTypes.ts';
import { clampDetailPanelWidth } from './workflowDiffPanelResize.ts';
import { workflowDiffNodeClass } from './workflowDiffNodeClass.ts';
import { isNodeSelected } from './selectedNodeState.ts';
import { clearDiffSelection } from './diffSelectionState.ts';
import { type FieldComparison, nodeFieldComparisons, edgeFieldComparisons } from './workflowDiffFieldComparisons.ts';
import './theme.css';
import './WorkflowDiffViewer.css';

export interface WorkflowDiffViewerProps {
  baseWorkflow: Workflow;
  compareWorkflow: Workflow;
  theme?: FlowTheme;
}

const DIFF_STATUSES: DiffStatus[] = ['added', 'removed', 'changed', 'cosmetic', 'unchanged'];

function formatDiffValue(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function WorkflowDiffViewerInner({
  baseWorkflow,
  compareWorkflow,
  theme = 'light',
}: WorkflowDiffViewerProps): JSX.Element {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(320);
  const isResizing = useRef(false);

  const diff = useMemo(() => diffWorkflows(baseWorkflow, compareWorkflow), [baseWorkflow, compareWorkflow]);

  const model = useMemo(
    () => buildDiffRenderModel(baseWorkflow, compareWorkflow, diff),
    [baseWorkflow, compareWorkflow, diff],
  );

  const laidOutNodes = useMemo(
    () => (needsLayout(model.nodes) ? layoutWorkflow(model.nodes, model.edges) : model.nodes),
    [model.nodes, model.edges],
  );

  const nodes = useMemo(
    () => toReactFlowNodes(laidOutNodes).map((node) => ({
      ...node,
      className: workflowDiffNodeClass(diff.nodes[node.id]?.status),
      selected: isNodeSelected(node.id, selectedNodeId),
      draggable: false,
    })),
    [laidOutNodes, diff.nodes, selectedNodeId],
  );

  const edges = useMemo(
    () => toReactFlowEdges(model.edges).map((edge) => ({
      ...edge,
      className: `flow-diff-edge flow-diff-edge--${diff.edges[edge.id]?.status ?? 'unchanged'}`,
      style: {
        ...(edge.style ?? {}),
        opacity: diff.edges[edge.id]?.status === 'removed' ? 0.45 : 1,
      },
      animated: false,
    })),
    [model.edges, diff.edges],
  );

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedEdgeId(null);
    setSelectedNodeId(node.id);
  }, []);

  const onEdgeClick = useCallback((_: unknown, edge: Edge) => {
    setSelectedNodeId(null);
    setSelectedEdgeId(edge.id);
  }, []);

  const onPaneClick = useCallback(() => {
    const cleared = clearDiffSelection({ selectedNodeId, selectedEdgeId });
    setSelectedNodeId(cleared.selectedNodeId);
    setSelectedEdgeId(cleared.selectedEdgeId);
  }, [selectedNodeId, selectedEdgeId]);

  const onResizeStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    isResizing.current = true;
    const startX = event.clientX;
    const startWidth = panelWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizing.current) {
        return;
      }
      setPanelWidth(clampDetailPanelWidth(startWidth, startX, moveEvent.clientX));
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [panelWidth]);

  const selectedNodeDiff = selectedNodeId ? diff.nodes[selectedNodeId] : undefined;
  const selectedEdgeDiff = selectedEdgeId ? diff.edges[selectedEdgeId] : undefined;
  const baseLabel = resolveWorkflowLabel(baseWorkflow);
  const compareLabel = resolveWorkflowLabel(compareWorkflow);

  return (
    <div className="workflow-diff-viewer" data-flow-theme={theme}>
      <div className="workflow-diff-viewer__main">
        <div className="workflow-diff-viewer__header">
          <div>{baseLabel} -&gt; {compareLabel}</div>
          <div className="workflow-diff-viewer__summary">
            Nodes: +{diff.summary.nodes.added} -{diff.summary.nodes.removed} ~{diff.summary.nodes.changed}
            | cosmetic {diff.summary.nodes.cosmetic}
          </div>
          <div className="workflow-diff-viewer__legend" aria-label="Diff status legend">
            {DIFF_STATUSES.map((status) => (
              <div key={status} className="workflow-diff-viewer__legend-item">
                <span
                  className={`workflow-diff-viewer__legend-swatch workflow-diff-viewer__legend-swatch--${status}`}
                  aria-hidden="true"
                />
                {status}
              </div>
            ))}
          </div>
        </div>
        {diff.warnings.length > 0 && (
          <div className="workflow-diff-viewer__warnings">
            {diff.warnings.map((warning) => (
              <div key={`${warning.code}-${warning.message}`}>{warning.message}</div>
            ))}
          </div>
        )}
        <div className="workflow-diff-viewer__canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            colorMode={theme}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            fitView
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>
      <div className="workflow-diff-viewer__detail" style={{ width: panelWidth }}>
        <div className="workflow-diff-viewer__resize-handle" onMouseDown={onResizeStart} />
        {selectedNodeDiff && (
          <DiffDetail
            kind="Node"
            id={selectedNodeDiff.id}
            status={selectedNodeDiff.status}
            changes={selectedNodeDiff.changes}
            fieldComparisons={nodeFieldComparisons(selectedNodeDiff)}
          />
        )}
        {selectedEdgeDiff && (
          <DiffDetail
            kind="Edge"
            id={selectedEdgeDiff.id}
            status={selectedEdgeDiff.status}
            changes={selectedEdgeDiff.changes}
            fieldComparisons={edgeFieldComparisons(selectedEdgeDiff)}
          />
        )}
        {!selectedNodeDiff && !selectedEdgeDiff && (
          <div className="workflow-diff-viewer__empty">Select a node or edge to inspect changes.</div>
        )}
      </div>
    </div>
  );
}

function DiffDetail(props: {
  kind: 'Node' | 'Edge';
  id: string;
  status: DiffStatus;
  changes: string[];
  fieldComparisons: FieldComparison[];
}): JSX.Element {
  return (
    <div>
      <div className="workflow-diff-viewer__detail-title">{props.kind} {props.id}</div>
      <div className={`workflow-diff-viewer__status workflow-diff-viewer__status--${props.status}`}>
        {props.status}
      </div>
      {props.fieldComparisons.length > 0 ? (
        <table className="workflow-diff-viewer__changes-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Before</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {props.fieldComparisons.map((comparison) => (
              <tr key={comparison.field}>
                <td>{comparison.field}</td>
                <td><pre>{formatDiffValue(comparison.before)}</pre></td>
                <td><pre>{formatDiffValue(comparison.after)}</pre></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : props.changes.length > 0 ? (
        <ul className="workflow-diff-viewer__changes">
          {props.changes.map((change) => <li key={change}>{change}</li>)}
        </ul>
      ) : (
        <div className="workflow-diff-viewer__empty">No field-level changes.</div>
      )}
    </div>
  );
}

export function WorkflowDiffViewer(props: WorkflowDiffViewerProps): JSX.Element {
  return (
    <ReactFlowProvider>
      <WorkflowDiffViewerInner {...props} />
    </ReactFlowProvider>
  );
}
