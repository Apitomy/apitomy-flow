import { type ComponentType } from 'react';
import { type NodeProps } from '@xyflow/react';
import { ExclamationCircleIcon, ExclamationTriangleIcon } from '@patternfly/react-icons';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './validationBadge.css';

/**
 * A small status icon layered on the node's top-left corner when the node has a
 * validation problem. The icon straddles the corner (outside the node box) and
 * is non-interactive. The severity is pre-resolved to the highest per node by
 * the editor, so an error node always shows the error icon.
 */
function ValidationBadge({ severity }: { severity: 'error' | 'warning' }) {
    const Icon = severity === 'error' ? ExclamationCircleIcon : ExclamationTriangleIcon;
    return (
        <span
            className={`flow-node-badge flow-node-badge--${severity}`}
            aria-hidden="true"
        >
            <Icon />
        </span>
    );
}

/**
 * Wraps a React Flow node component so it renders a corner validation badge
 * whenever its data carries a {@link FlowNodeData.validationSeverity}.
 *
 * @param Component the node component to wrap
 * @returns a component that renders the original node plus the validation badge
 */
export function withValidationBadge(Component: ComponentType<NodeProps>): ComponentType<NodeProps> {
    return function WithValidationBadge(props: NodeProps) {
        const data = props.data as FlowNodeData;
        return (
            <>
                <Component {...props} />
                {data.validationSeverity ? <ValidationBadge severity={data.validationSeverity} /> : null}
            </>
        );
    };
}
