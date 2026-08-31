import { type ComponentType } from 'react';
import { type NodeProps } from '@xyflow/react';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './currentNodeRing.css';

/**
 * Outer corner radius of the ring per node type. The ring sits 4px outside the
 * node border, so these are the node's own radius (8px cards, 20px start/end
 * pills) plus that offset.
 */
const RING_RADIUS_BY_TYPE: Record<string, number> = {
    start: 24,
    end: 24,
};

const DEFAULT_RING_RADIUS: number = 12;

/**
 * An SVG outline overlay with animated, evenly-spaced marching dashes that
 * follows the node's rounded/pill shape. Uses the same primitive as the flow
 * edges (a dashed stroke with an animated stroke-dashoffset), rendered as a
 * rounded rectangle so the dashes wrap the corners cleanly.
 */
function CurrentNodeRing({ radius }: { radius: number }) {
    return (
        <svg className="flow-node-ring" aria-hidden="true">
            <rect
                className="flow-node-ring__path"
                x="0"
                y="0"
                width="100%"
                height="100%"
                rx={radius}
                ry={radius}
                fill="none"
            />
        </svg>
    );
}

/**
 * Wraps a React Flow node component so it renders the animated marching-ants
 * ring whenever its data marks it as the instance's current/waiting node.
 *
 * @param Component the node component to wrap
 * @returns a component that renders the original node plus the current-node ring
 */
export function withCurrentRing(Component: ComponentType<NodeProps>): ComponentType<NodeProps> {
    return function WithCurrentRing(props: NodeProps) {
        const data = props.data as FlowNodeData & { isCurrent?: boolean };
        const radius: number = RING_RADIUS_BY_TYPE[props.type] ?? DEFAULT_RING_RADIUS;
        return (
            <>
                <Component {...props} />
                {data.isCurrent ? <CurrentNodeRing radius={radius} /> : null}
            </>
        );
    };
}
