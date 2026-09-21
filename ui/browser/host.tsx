import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkflowEditor, WorkflowViewer, WorkflowDiffViewer,
    type Workflow, type EditorSpi, type ActionTypeDescriptor, type ValidationProblem } from '../src/index.ts';
import { workflow, importedWorkflow, instance } from './fixtures.ts';
import '@patternfly/patternfly/patternfly.css';
import '@xyflow/react/dist/style.css';
import './host.css';

const params = new URLSearchParams(location.search);

function EditorHost({ id }: { id: string }) {
    const [document, setDocument] = useState(() => workflow(!params.has('positionless')));
    const [changes, setChanges] = useState<Workflow[]>([]);
    const [mount, setMount] = useState(0);
    const [provider, setProvider] = useState(0);
    const [validationCount, setValidationCount] = useState(0);
    const [pending] = useState(() => ({
        actions: [] as { generation: number; resolve: (value: ActionTypeDescriptor[]) => void; reject: () => void }[],
        validations: [] as { workflow: Workflow; resolve: (value: ValidationProblem[]) => void; reject: () => void }[],
    }));
    const spi = useMemo<EditorSpi | undefined>(() => params.has('async') ? {
        actionTypes: () => new Promise((resolve, reject) => {
            pending.actions.push({ generation: provider, resolve, reject: () => reject(new Error('Host unavailable')) });
        }),
        validate: workflow => new Promise((resolve, reject) => {
            pending.validations.push({ workflow: structuredClone(workflow), resolve,
                reject: () => reject(new Error('Host unavailable')) });
            setValidationCount(pending.validations.length);
        }),
    } : undefined, [pending, provider]);
    return <section data-testid={id}>
        <nav aria-label={`${id} host controls`}>
            <button onClick={() => setDocument(importedWorkflow())}>Replace props</button>
            <button onClick={() => setMount(value => value + 1)}>Remount</button>
            <button onClick={() => setProvider(value => value + 1)}>Replace provider</button>
            <button onClick={() => pending.actions.filter(item => item.generation === provider).forEach(item => item.resolve([
                { value: 'noop', label: 'Current action', description: 'Current provider description' },
            ]))}>Resolve current actions</button>
            <button onClick={() => pending.actions.filter(item => item.generation !== provider).forEach(item => item.resolve([
                { value: 'noop', label: 'Stale action', description: 'Stale provider description' },
            ]))}>Resolve stale actions</button>
            <button onClick={() => pending.actions.forEach(item => item.reject())}>Reject actions</button>
            <button onClick={() => pending.validations.at(-1)?.resolve([
                { severity: 'warning', code: 'HOST', message: 'Current host warning', nodeId: 'a' },
            ])}>Resolve validation</button>
            <button onClick={() => pending.validations.slice(0, -1).forEach(item => item.resolve([
                { severity: 'error', code: 'STALE', message: 'Stale host warning', nodeId: 'a' },
            ]))}>Resolve stale validation</button>
            <button onClick={() => pending.validations.at(-1)?.reject()}>Reject validation</button>
        </nav>
        <div className="surface"><WorkflowEditor key={mount} workflow={document} spi={spi} onChange={next => {
            setChanges(previous => [...previous, structuredClone(next)]);
            if (params.has('echo')) setDocument(next);
            if (params.has('mutate')) next.nodes.length = 0;
        }} /></div>
        <output data-testid="changes">{JSON.stringify(changes)}</output>
        <output data-testid="validation-count">{validationCount}</output>
        <output data-testid="validation-documents">{JSON.stringify(pending.validations.map(item => item.workflow))}</output>
    </section>;
}

function Viewers() {
    const [updated, setUpdated] = useState(false);
    const base = useMemo(() => {
        const definition = workflow(false);
        definition.edges.push({ id: 'loop', source: 'h', target: 'a', condition: 'context.retry',
            priority: 1, isDefault: false });
        return definition;
    }, []);
    const compare = useMemo(() => {
        const next = structuredClone(base);
        if (updated) next.nodes[1].name = 'Updated action';
        return next;
    }, [base, updated]);
    return <>
        <button onClick={() => setUpdated(value => !value)}>Update viewers</button>
        <div className="surface" data-testid="viewer"><WorkflowViewer workflow={compare} instance={instance(updated)} /></div>
        <div className="surface" data-testid="diff"><WorkflowDiffViewer baseWorkflow={base} compareWorkflow={compare} /></div>
    </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode>
    <label>Host text <input aria-label="Host text" /></label>
    <div contentEditable suppressContentEditableWarning role="textbox" aria-label="Host rich text">Host rich text</div>
    {params.has('viewers') ? <Viewers /> : <><EditorHost id="one" />{params.has('two') && <EditorHost id="two" />}</>}
</StrictMode>);
