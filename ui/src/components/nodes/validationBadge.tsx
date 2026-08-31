import { type ComponentType } from 'react';
import { type NodeProps } from '@xyflow/react';
import { ExclamationCircleIcon, ExclamationTriangleIcon } from '@patternfly/react-icons';
import { Tooltip } from '@patternfly/react-core';
import { type ValidationProblem } from '../../types/validation.ts';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './validationBadge.css';

/**
 * The highest severity across a node's problems ('error' outranks 'warning'),
 * or undefined when the node has none.
 */
function highestSeverity(problems: ValidationProblem[]): 'error' | 'warning' | undefined {
    if (problems.some(p => p.severity === 'error')) return 'error';
    if (problems.some(p => p.severity === 'warning')) return 'warning';
    return undefined;
}

/**
 * A small status icon layered on the node's top-left corner when the node has
 * validation problems. The icon straddles the corner (outside the node box) and,
 * on hover, shows a tooltip listing the specific problems (errors first). The
 * icon reflects the highest severity, so an errored node always shows the error
 * icon.
 */
function ValidationBadge({ problems }: { problems: ValidationProblem[] }) {
    const severity = highestSeverity(problems);
    if (!severity) return null;

    const Icon = severity === 'error' ? ExclamationCircleIcon : ExclamationTriangleIcon;
    const sorted = [...problems].sort((a, b) =>
        a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1,
    );

    const tooltipContent = (
        <ul className="flow-node-badge__tooltip-list">
            {sorted.map((p, i) => (
                <li key={`${p.code}-${i}`} className={`flow-node-badge__tooltip-item flow-node-badge__tooltip-item--${p.severity}`}>
                    {p.message}
                </li>
            ))}
        </ul>
    );

    return (
        <Tooltip content={tooltipContent} position="top">
            <span className={`flow-node-badge flow-node-badge--${severity}`}>
                <Icon />
            </span>
        </Tooltip>
    );
}

/**
 * Wraps a React Flow node component so it renders a corner validation badge
 * whenever its data carries {@link FlowNodeData.validationProblems}.
 *
 * @param Component the node component to wrap
 * @returns a component that renders the original node plus the validation badge
 */
export function withValidationBadge(Component: ComponentType<NodeProps>): ComponentType<NodeProps> {
    return function WithValidationBadge(props: NodeProps) {
        const data = props.data as FlowNodeData;
        const problems = data.validationProblems ?? [];
        return (
            <>
                <Component {...props} />
                {problems.length > 0 ? <ValidationBadge problems={problems} /> : null}
            </>
        );
    };
}
