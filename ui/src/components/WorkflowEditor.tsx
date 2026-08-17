import { useCallback, useMemo, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import { type Workflow } from '../types/workflow.ts';
import { type ValidationProblem } from '../types/validation.ts';
import { type FlowNodeData, toReactFlowNodes, toReactFlowEdges, toWorkflow } from '../utils/conversion.ts';
import { generateNodeId, generateEdgeId } from '../utils/id.ts';
import { nodeTypes } from './nodes/nodeTypes.ts';
import { edgeTypes } from './edges/edgeTypes.ts';
import { NodePalette } from './panels/NodePalette.tsx';
import './WorkflowEditor.css';

export interface WorkflowEditorProps {
  workflow: Workflow;
  onChange: (workflow: Workflow) => void;
  validationProblems?: ValidationProblem[];
  onValidationChange?: (problems: ValidationProblem[]) => void;
}

function WorkflowEditorInner({ workflow, onChange, validationProblems }: WorkflowEditorProps) {
  const initialNodes = useMemo(() => toReactFlowNodes(workflow.nodes), []);
  const initialEdges = useMemo(() => toReactFlowEdges(workflow.edges), []);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { screenToFlowPosition } = useReactFlow();

  const nodesWithValidation = useMemo(() => {
    if (!validationProblems?.length) return nodes;
    return nodes.map(node => {
      const problems = validationProblems.filter(p => p.nodeId === node.id);
      const severity: 'error' | 'warning' | undefined = problems.some(p => p.severity === 'error') ? 'error'
        : problems.some(p => p.severity === 'warning') ? 'warning' : undefined;
      return severity ? { ...node, data: { ...node.data, validationSeverity: severity } } : node;
    });
  }, [nodes, validationProblems]);

  const emitChange = useCallback((updatedNodes: Node<FlowNodeData>[], updatedEdges: Edge[]) => {
    onChange(toWorkflow(workflow.id, workflow.name, updatedNodes, updatedEdges));
  }, [workflow.id, workflow.name, onChange]);

  const handleNodesChange: typeof onNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    setNodes(current => {
      const updated = current;
      setTimeout(() => emitChange(updated, edges), 0);
      return current;
    });
  }, [onNodesChange, edges, emitChange, setNodes]);

  const handleEdgesChange: typeof onEdgesChange = useCallback((changes) => {
    onEdgesChange(changes);
    setEdges(current => {
      const updated = current;
      setTimeout(() => emitChange(nodes, updated), 0);
      return current;
    });
  }, [onEdgesChange, nodes, emitChange, setEdges]);

  const onConnect = useCallback((connection: Connection) => {
    const edgeId = generateEdgeId(connection.source!, connection.target!);
    const newEdge: Edge = {
      ...connection,
      id: edgeId,
      type: 'conditional',
      data: { condition: undefined, priority: 0, isDefault: false },
    };
    setEdges(eds => {
      const updated = addEdge(newEdge, eds);
      setTimeout(() => emitChange(nodes, updated), 0);
      return updated;
    });
  }, [setEdges, nodes, emitChange]);

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    const nodeType = event.dataTransfer.getData('application/reactflow-nodetype');
    if (!nodeType) return;

    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const newNode: Node<FlowNodeData> = {
      id: generateNodeId(nodeType),
      type: nodeType,
      position,
      data: {
        name: nodeType.charAt(0).toUpperCase() + nodeType.slice(1).replace(/-/g, ' '),
        nodeType: nodeType as FlowNodeData['nodeType'],
        config: nodeType === 'action' ? { actionType: '' } : {},
      },
    };

    setNodes(nds => {
      const updated = [...nds, newNode];
      setTimeout(() => emitChange(updated, edges), 0);
      return updated;
    });
  }, [screenToFlowPosition, setNodes, edges, emitChange]);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <div className="workflow-editor">
      <NodePalette />
      <div className="workflow-editor__canvas">
        <ReactFlow
          nodes={nodesWithValidation}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={{ type: 'conditional' }}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}

export function WorkflowEditor(props: WorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
