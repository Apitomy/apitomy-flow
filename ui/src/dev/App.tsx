import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import {
  FormSelect,
  FormSelectOption,
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadMain,
  MastheadToggle,
  Nav,
  NavItem,
  NavList,
  Page,
  PageSection,
  PageSidebar,
  PageSidebarBody,
  PageToggleButton,
  Switch,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import '@patternfly/patternfly/patternfly.css';
import '@xyflow/react/dist/style.css';
import { BarsIcon, FileAltIcon, SearchIcon, ExternalLinkAltIcon } from '@patternfly/react-icons';
import { WorkflowEditor } from '../components/WorkflowEditor.tsx';
import { WorkflowDiffViewer } from '../components/WorkflowDiffViewer.tsx';
import { WorkflowViewer, type WorkflowViewerNodeMenuItem } from '../components/WorkflowViewer.tsx';
import { demoScenarios } from './sampleWorkflows.ts';
import { workflowDiffScenarios } from './workflowDiffScenarios.ts';
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
import { demoCatalog, createHostValidator } from './demoCatalog.ts';
import { AiAssistedEditorDemo } from './ai/AiAssistedEditorDemo.tsx';
import './App.css';

const spi: EditorSpi = {
  actionTypes: demoCatalog,
  validate: createHostValidator(demoCatalog),
};

function App() {
  const defaultScenario = demoScenarios[0];
  const defaultDiffScenario = workflowDiffScenarios[0];
  const [activeView, setActiveView] = useState<DemoNavKey>('editor');
  const [scenarioSelectionState, setScenarioSelectionState] = useState(
    createScenarioSelectionState(defaultScenario.key, defaultDiffScenario.key),
  );
  const [editorWorkflow, setEditorWorkflow] = useState<Workflow>(defaultScenario.workflow);
  const [theme, setTheme] = useState<FlowTheme>('light');
  const [editorReadOnly, setEditorReadOnly] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    syncPatternFlyRootTheme(theme);
    return () => {
      syncPatternFlyRootTheme('light');
    };
  }, [theme]);

  const editorScenarioKey = getScenarioKeyForView(scenarioSelectionState, 'editor');
  const viewerScenarioKey = getScenarioKeyForView(scenarioSelectionState, 'viewer');
  const diffScenarioKey = getScenarioKeyForView(scenarioSelectionState, 'diff');
  const activeScenarioKey = getScenarioKeyForView(scenarioSelectionState, activeView);

  const selectedViewerScenario =
    demoScenarios.find((scenario) => scenario.key === viewerScenarioKey) ?? defaultScenario;
  const selectedDiffScenario =
    workflowDiffScenarios.find((scenario) => scenario.key === diffScenarioKey) ?? defaultDiffScenario;

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
    const scenarioExists =
      activeView === 'diff'
        ? workflowDiffScenarios.some((scenario) => scenario.key === nextScenarioKey)
        : demoScenarios.some((scenario) => scenario.key === nextScenarioKey);
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
    if (demoNavItems.some((item) => item.key === result.itemId)) {
      setActiveView(result.itemId as DemoNavKey);
      // The AI assistant needs the width; the masthead toggle brings the navigation back.
      if (result.itemId === 'ai') setSidebarOpen(false);
    }
  }

  const sidebar = (
    <PageSidebar isSidebarOpen={sidebarOpen}>
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
        <MastheadToggle>
          <PageToggleButton isHamburgerButton isSidebarOpen={sidebarOpen}
            onSidebarToggle={() => setSidebarOpen((open) => !open)} aria-label="Toggle demo navigation">
            <BarsIcon />
          </PageToggleButton>
        </MastheadToggle>
        <MastheadBrand>
          Apitomy Flow Demo
          <a
            href="https://apitomy.io/projects/flow/"
            target="_blank"
            rel="noreferrer"
            style={{ marginLeft: '1rem', fontSize: '0.75rem', fontWeight: 'normal' }}
          >
            apitomy.io <ExternalLinkAltIcon />
          </a>
        </MastheadBrand>
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
      {activeView !== 'ai' && <PageSection className="dev-app__toolbar-section">
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
                  {(activeView === 'diff' ? workflowDiffScenarios : demoScenarios).map((scenario) => (
                    <FormSelectOption key={scenario.key} value={scenario.key} label={scenario.label} />
                  ))}
                </FormSelect>
              </ToolbarItem>
              {activeView === 'editor' && (
                <ToolbarItem className="dev-app__read-only-toggle">
                  <Switch
                    id="read-only-toggle"
                    label="Read-only"
                    aria-label="Toggle read-only editor mode"
                    isChecked={editorReadOnly}
                    onChange={(_, checked) => setEditorReadOnly(checked)}
                  />
                </ToolbarItem>
              )}
            </ToolbarGroup>
          </ToolbarContent>
        </Toolbar>
      </PageSection>}
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
            readOnly={editorReadOnly}
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
        {activeView === 'ai' && <AiAssistedEditorDemo theme={theme} />}
        {activeView === 'diff' && (
          <WorkflowDiffViewer
            baseWorkflow={selectedDiffScenario.baseWorkflow}
            compareWorkflow={selectedDiffScenario.compareWorkflow}
            theme={theme}
          />
        )}
      </PageSection>
    </Page>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
