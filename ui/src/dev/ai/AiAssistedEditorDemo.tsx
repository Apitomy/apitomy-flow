import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Switch, ToggleGroup, ToggleGroupItem } from '@patternfly/react-core';
import { WorkflowEditor, type FlowTheme } from '../../components/WorkflowEditor.tsx';
import type { WorkflowEditorHandle } from '../../hooks/editorHandle.ts';
import type { ChangeMeta } from '../../changeset/types.ts';
import type { ActionTypeDescriptor, ContextAction, EditorSpi, FlowContext } from '../../types/spi.ts';
import type { Workflow } from '../../types/workflow.ts';
import { cveTriage } from '../sampleWorkflows.ts';
import { demoCatalog, createHostValidator } from '../demoCatalog.ts';
import { respond, spacedOut, type AgentRequest } from './mockAgent.ts';
import './AiAssistedEditorDemo.css';

type Mode = 'suggest' | 'apply';
interface ChatEntry { id: number; role: 'user' | 'assistant' | 'event'; text: string }

const QUICK_PROMPTS: { label: string; request: AgentRequest }[] = [
  { label: 'Add error handling', request: { kind: 'add-error-handling' } },
  { label: 'Add a wait after Analyze CVE', request: { kind: 'add-wait', nodeId: 'analyze' } },
];

/** CVE Triage with extra horizontal room so inserted steps fit between their neighbours. */
const demoWorkflow: Workflow = spacedOut(cveTriage, 1.4);

const shortRevision = (revision: string) => `${revision.slice(0, 15)}…`;

/** Props for {@link AiAssistedEditorDemo}. */
export interface AiAssistedEditorDemoProps {
  theme: FlowTheme;
}

/**
 * Demo of the AI-assisted editing features: a scripted assistant drives change sets (propose or apply), context
 * actions start requests from the canvas, and a live host catalog resolves Action Types on the fly.
 */
export function AiAssistedEditorDemo({ theme }: AiAssistedEditorDemoProps) {
  const editorRef = useRef<WorkflowEditorHandle>(null);
  const nextId = useRef(1);
  const [session, setSession] = useState(0);
  const [mode, setMode] = useState<Mode>('suggest');
  const [slow, setSlow] = useState(false);
  const [catalog, setCatalog] = useState<ActionTypeDescriptor[]>(demoCatalog);
  const [chat, setChat] = useState<ChatEntry[]>([{ id: 0, role: 'assistant', text:
    'Hi! Right-click a step, the canvas or a problem to ask me for help, or pick a quick prompt below. ' +
    'In "Suggest" mode my changes appear as a proposal for you to review.' }]);

  const chatRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [chat]);

  const say = (role: ChatEntry['role'], text: string) => {
    const id = nextId.current;
    nextId.current += 1;
    setChat(previous => [...previous, { id, role, text }]);
  };

  const ask = async (label: string, request: AgentRequest) => {
    const editor = editorRef.current;
    if (!editor) return;
    say('user', label);
    const snapshot = editor.getSnapshot();
    if (slow) say('event', 'Thinking for 3 seconds… try editing the workflow meanwhile.');
    await new Promise(resolve => setTimeout(resolve, slow ? 3000 : 400));
    const response = respond(request, snapshot.workflow, snapshot.contentRevision);
    say('assistant', response.message);
    if (response.addActionTypes?.length) {
      setCatalog(previous => [...previous, ...response.addActionTypes!.filter(added =>
        !previous.some(existing => existing.value === added.value))]);
      say('event', `Host added ${response.addActionTypes.map(added => `"${added.value}"`).join(', ')} to the catalog.`);
    }
    if (!response.changeSet) return;
    const result = mode === 'suggest' ? editor.propose(response.changeSet) : editor.apply(response.changeSet);
    if (result.status === 'rejected' && result.error.code === 'stale') {
      say('event', `Change set rejected (stale): it was based on revision ${shortRevision(response.changeSet.baseRevision)}, `
        + `but the workflow changed meanwhile (now ${shortRevision(editor.getSnapshot().contentRevision)}). Ask again.`);
    } else if (result.status === 'rejected') {
      say('event', `Change set rejected (${result.error.code}): ${result.error.reason}`);
    } else if (result.status === 'staged') {
      say('event', 'Proposal staged. Review it on the canvas and Accept or Reject.');
    } else {
      say('event', 'Applied as one undoable step and highlighted on the canvas.');
    }
  };

  // Recreated with the latest state on every render; the editor calls it when a menu opens.
  const contextActions = (context: FlowContext): ContextAction[] => {
    const run = (label: string, request: AgentRequest) => () => { void ask(label, request); };
    const target = context.target;
    if (target.kind === 'node') {
      const name = context.workflow.nodes.find(node => node.id === target.nodeId)?.name ?? target.nodeId;
      const items: ContextAction[] = [
        { id: 'explain', label: 'Explain this step', onSelect: run(`Explain "${name}"`, { kind: 'explain', nodeId: target.nodeId }) },
      ];
      if (!context.readOnly) {
        items.unshift(
          { id: 'add-wait', label: 'Add a wait after this step',
            onSelect: run(`Add a wait after "${name}"`, { kind: 'add-wait', nodeId: target.nodeId }) },
          { id: 'rename', label: 'Rename with AI', onSelect: run(`Suggest a better name for "${name}"`, { kind: 'rename', nodeId: target.nodeId }) },
        );
      }
      return items;
    }
    if (target.kind === 'canvas' && !context.readOnly) {
      return [{ id: 'notify', label: 'Add a notification here',
        onSelect: run('Add a notification step here', { kind: 'add-notification', position: target.flowPosition }) }];
    }
    if (target.kind === 'problem') {
      return [{ id: 'fix', label: 'Ask AI to fix',
        onSelect: run(`Fix: ${target.problem.message}`, { kind: 'fix-problem', problem: target.problem }) }];
    }
    return [];
  };
  const contextActionsRef = useRef(contextActions);
  useLayoutEffect(() => { contextActionsRef.current = contextActions; });

  const validate = useMemo(() => createHostValidator(catalog), [catalog]);
  const spi = useMemo<EditorSpi>(() => ({
    actionTypes: catalog,
    validate,
    contextActions: context => contextActionsRef.current(context),
    openActionType: ({ value, resolved }) =>
      say('event', `Host would ${resolved ? 'open' : 'create'} the "${value}" Action Type in its editor.`),
  }), [catalog, validate]);

  const onChange = (_workflow: Workflow, meta: ChangeMeta) => {
    if (meta.origin !== 'user') say('event', `Workflow changed by ${meta.origin} (revision ${shortRevision(meta.contentRevision)}).`);
  };

  const reset = () => {
    setCatalog(demoCatalog);
    setSession(previous => previous + 1);
    say('event', 'Workflow and catalog reset.');
  };

  return (
    <div className="ai-demo">
      <div className="ai-demo__editor">
        <WorkflowEditor key={session} ref={editorRef} workflow={demoWorkflow} theme={theme} spi={spi} onChange={onChange}
          onProposalResolved={(id, outcome) => say('event', `Proposal ${id} ${outcome}.`)} />
      </div>
      <aside className="ai-demo__assistant" aria-label="AI assistant">
        <header className="ai-demo__header">
          <h2>AI Assistant</h2>
          <ToggleGroup aria-label="How the assistant applies changes">
            <ToggleGroupItem text="Suggest" buttonId="ai-mode-suggest" isSelected={mode === 'suggest'} onChange={() => setMode('suggest')} />
            <ToggleGroupItem text="Do it" buttonId="ai-mode-apply" isSelected={mode === 'apply'} onChange={() => setMode('apply')} />
          </ToggleGroup>
          <Switch id="ai-slow" label="Simulate slow agent (3s)" isChecked={slow} onChange={(_, checked) => setSlow(checked)} />
        </header>
        <ol ref={chatRef} className="ai-demo__chat" aria-live="polite">
          {chat.map(entry => (
            <li key={entry.id} className={`ai-demo__msg ai-demo__msg--${entry.role}`}>{entry.text}</li>
          ))}
        </ol>
        <footer className="ai-demo__footer">
          <div className="ai-demo__prompts">
            {QUICK_PROMPTS.map(prompt => (
              <Button key={prompt.label} variant="secondary" size="sm" onClick={() => { void ask(prompt.label, prompt.request); }}>
                {prompt.label}
              </Button>
            ))}
          </div>
          <Button variant="link" size="sm" onClick={reset}>Reset demo</Button>
        </footer>
      </aside>
    </div>
  );
}
