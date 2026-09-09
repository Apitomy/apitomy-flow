import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import {
  FormSelect,
  FormSelectOption,
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadMain,
  Nav,
  NavItem,
  NavList,
  Page,
  PageSection,
  PageSidebar,
  PageSidebarBody,
  Switch,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import '@patternfly/patternfly/patternfly.css';
import '@xyflow/react/dist/style.css';
import { FileAltIcon, SearchIcon, ExternalLinkAltIcon } from '@patternfly/react-icons';
import { WorkflowEditor } from '../components/WorkflowEditor.tsx';
import { WorkflowViewer, type WorkflowViewerNodeMenuItem } from '../components/WorkflowViewer.tsx';
import { demoScenarios } from './sampleWorkflows.ts';
import { demoNavItems, type DemoNavKey } from './navigationModel.ts';
import {
  createScenarioSelectionState,
  getScenarioKeyForView,
  updateScenarioForActiveView,
} from './scenarioSelectionState.ts';
import { getContentSectionConfig } from './layoutModel.ts';
import { syncPatternFlyRootTheme } from './themeRootClass.ts';
import { type Workflow } from '../types/workflow.ts';
import { type FlowTheme } from '../components/WorkflowEditor.tsx';
import { type EditorSpi } from '../types/spi.ts';
import { type ValidationProblem } from '../types/validation.ts';
import './App.css';

const spi: EditorSpi = {
  actionTypes: [
    {
      value: 'send-email',
      label: 'Send Email',
      description: 'Send an email notification via the configured SMTP gateway',
      inputs: [
        { name: 'to', type: 'string', required: true, description: 'Recipient email address' },
        { name: 'subject', type: 'string', required: true },
        { name: 'body', type: 'string', required: true },
        { name: 'cc', type: 'string', required: false },
      ],
      outputs: [
        { name: 'messageId', type: 'string', required: true },
        { name: 'timestamp', type: 'string', required: true },
      ],
    },
    {
      value: 'http-request',
      label: 'HTTP Request',
      description: 'Make an outbound HTTP request to an external service',
      inputs: [
        { name: 'url', type: 'string', required: true },
        { name: 'method', type: 'string', required: true, description: 'GET, POST, PUT, DELETE' },
        { name: 'headers', type: 'object', required: false },
        { name: 'body', type: 'object', required: false },
      ],
      outputs: [
        { name: 'statusCode', type: 'number', required: true },
        { name: 'responseBody', type: 'object', required: true },
        { name: 'responseHeaders', type: 'object', required: true },
      ],
    },
    {
      value: 'lookup-cve',
      label: 'Lookup CVE',
      description: 'Query the NVD database for CVE details and severity scores',
      inputs: [
        { name: 'cveId', type: 'string', required: true, description: 'CVE identifier (e.g. CVE-2024-1234)' },
      ],
      outputs: [
        { name: 'severity', type: 'string', required: true },
        { name: 'cvssScore', type: 'number', required: true },
        { name: 'description', type: 'string', required: true },
        { name: 'affectedProducts', type: 'object', required: true },
      ],
    },
    {
      value: 'create-jira-ticket',
      label: 'Create Jira Ticket',
      description: 'Create a new issue in the configured Jira project',
      inputs: [
        { name: 'project', type: 'string', required: true },
        { name: 'issueType', type: 'string', required: true },
        { name: 'summary', type: 'string', required: true },
        { name: 'description', type: 'string', required: false },
        { name: 'priority', type: 'string', required: false },
      ],
      outputs: [
        { name: 'issueKey', type: 'string', required: true },
        { name: 'issueUrl', type: 'string', required: true },
      ],
    },
  ],
  validate: async (wf): Promise<ValidationProblem[]> => {
    const problems: ValidationProblem[] = [];
    const known = new Set(['send-email', 'http-request', 'lookup-cve', 'create-jira-ticket']);

    // Synchronous host rule: action type must be in the host's catalog.
    for (const node of wf.nodes) {
      if (node.type === 'action') {
        const actionType = node.config.actionType;
        if (typeof actionType === 'string' && actionType.trim() !== '' && !known.has(actionType)) {
          problems.push({
            severity: 'error',
            code: 'HOST_UNKNOWN_ACTION_TYPE',
            message: `Action type "${actionType}" is not in the host catalog`,
            nodeId: node.id,
          });
        }
      }
    }

    // Simulated backend latency to demonstrate the debounced/async path.
    await new Promise((resolve) => setTimeout(resolve, 400));

    if (wf.name && wf.name.length > 40) {
      problems.push({
        severity: 'warning',
        code: 'HOST_NAME_TOO_LONG',
        message: 'Workflow name exceeds the host limit of 40 characters',
      });
    }

    return problems;
  },
};

function App() {
  const defaultScenario = demoScenarios[0];
  const [activeView, setActiveView] = useState<DemoNavKey>('editor');
  const [scenarioSelectionState, setScenarioSelectionState] = useState(
    createScenarioSelectionState(defaultScenario.key),
  );
  const [editorWorkflow, setEditorWorkflow] = useState<Workflow>(defaultScenario.workflow);
  const [theme, setTheme] = useState<FlowTheme>('light');

  useEffect(() => {
    syncPatternFlyRootTheme(theme);
    return () => {
      syncPatternFlyRootTheme('light');
    };
  }, [theme]);

  const editorScenarioKey = getScenarioKeyForView(scenarioSelectionState, 'editor');
  const viewerScenarioKey = getScenarioKeyForView(scenarioSelectionState, 'viewer');
  const activeScenarioKey = getScenarioKeyForView(scenarioSelectionState, activeView);

  const selectedViewerScenario =
    demoScenarios.find((scenario) => scenario.key === viewerScenarioKey) ?? defaultScenario;

  /**
   * Demonstrates a host contributing its own actions to a viewer node's
   * right-click context menu. Uses the function form so the menu can vary per
   * node (here, "Jump to trace span" only appears for nodes that actually ran).
   */
  function nodeContextMenuItems(nodeId: string): WorkflowViewerNodeMenuItem[] {
    const items: WorkflowViewerNodeMenuItem[] = [
      {
        id: 'open-log',
        label: 'Open execution log',
        icon: <FileAltIcon />,
        onSelect: (id) => alert(`Host: open execution log for node "${id}"`),
      },
      {
        id: 'inspect',
        label: 'Inspect node',
        icon: <SearchIcon />,
        onSelect: (id) => alert(`Host: inspect node "${id}"`),
      },
    ];

    const wasVisited = selectedViewerScenario.instance.history.some((entry) => entry.nodeId === nodeId);
    if (wasVisited) {
      items.push({
        id: 'open-trace',
        label: 'Jump to trace span',
        icon: <ExternalLinkAltIcon />,
        danger: true,
        onSelect: (id) => alert(`Host: jump to trace span for node "${id}"`),
      });
    }

    return items;
  }

  function handleScenarioChange(nextScenarioKey: string): void {
    const scenarioExists = demoScenarios.some((scenario) => scenario.key === nextScenarioKey);
    if (!scenarioExists) {
      return;
    }
    const nextScenario = demoScenarios.find((scenario) => scenario.key === nextScenarioKey) ?? defaultScenario;

    if (activeView === 'editor') {
      setEditorWorkflow(nextScenario.workflow);
    }

    setScenarioSelectionState((prevState) =>
      updateScenarioForActiveView(prevState, activeView, nextScenarioKey),
    );
  }

  function onNavSelect(_event: React.FormEvent<HTMLInputElement>, result: { itemId: number | string }): void {
    if (result.itemId === 'editor' || result.itemId === 'viewer') {
      setActiveView(result.itemId);
    }
  }

  const sidebar = (
    <PageSidebar isSidebarOpen>
      <PageSidebarBody>
        <Nav onSelect={onNavSelect} aria-label="Demo navigation">
          <NavList>
            {demoNavItems.map((item) => (
              <NavItem
                preventDefault
                key={item.key}
                id={`demo-nav-${item.key}`}
                to={`#${item.key}`}
                itemId={item.key}
                isActive={activeView === item.key}
              >
                {item.label}
              </NavItem>
            ))}
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  );

  const masthead = (
    <Masthead>
      <MastheadMain>
        <MastheadBrand>Apitomy Flow Demo</MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar id="masthead-theme-toolbar" isStatic>
          <ToolbarContent>
            <ToolbarGroup align={{ default: 'alignEnd' }}>
              <ToolbarItem>
                <Switch
                  id="theme-toggle"
                  label="Dark mode"
                  isChecked={theme === 'dark'}
                  onChange={(_, checked) => setTheme(checked ? 'dark' : 'light')}
                  aria-label="Toggle dark mode"
                />
              </ToolbarItem>
            </ToolbarGroup>
          </ToolbarContent>
        </Toolbar>
      </MastheadContent>
    </Masthead>
  );

  const contentSectionConfig = getContentSectionConfig();

  return (
    <Page
      isContentFilled
      className={`dev-app ${theme === 'dark' ? 'dev-app--dark' : ''}`}
      masthead={masthead}
      sidebar={sidebar}
    >
      <PageSection className="dev-app__toolbar-section">
        <Toolbar className="dev-app__toolbar" inset={{ default: 'insetMd' }}>
          <ToolbarContent>
            <ToolbarGroup>
              <ToolbarItem variant="label">Scenario</ToolbarItem>
              <ToolbarItem>
                <FormSelect
                  className="dev-app__scenario-select"
                  value={activeScenarioKey}
                  onChange={(_, value) => handleScenarioChange(value as string)}
                  aria-label="Select demo scenario"
                  id="scenario-select"
                >
                  {demoScenarios.map((scenario) => (
                    <FormSelectOption key={scenario.key} value={scenario.key} label={scenario.label} />
                  ))}
                </FormSelect>
              </ToolbarItem>
            </ToolbarGroup>
          </ToolbarContent>
        </Toolbar>
      </PageSection>
      <PageSection
        isFilled={contentSectionConfig.isFilled}
        hasBodyWrapper={contentSectionConfig.hasBodyWrapper}
        padding={{ default: 'noPadding' }}
        className="dev-app__content"
      >
        {activeView === 'editor' && (
            <WorkflowEditor
              key={editorScenarioKey}
              workflow={editorWorkflow}
              onChange={setEditorWorkflow}
              theme={theme}
              spi={spi}
            />
        )}
        {activeView === 'viewer' && (
            <WorkflowViewer
                workflow={selectedViewerScenario.workflow}
                instance={selectedViewerScenario.instance}
                theme={theme}
                nodeContextMenuItems={nodeContextMenuItems}
            />
        )}
      </PageSection>
    </Page>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
