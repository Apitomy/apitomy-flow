import { type DemoNavKey } from './navigationModel.ts';

export interface ScenarioSelectionState {
  editorScenarioKey: string;
  viewerScenarioKey: string;
  diffScenarioKey: string;
}

export function createScenarioSelectionState(
  defaultScenarioKey: string,
  defaultDiffScenarioKey: string,
): ScenarioSelectionState {
  return {
    editorScenarioKey: defaultScenarioKey,
    viewerScenarioKey: defaultScenarioKey,
    diffScenarioKey: defaultDiffScenarioKey,
  };
}

export function getScenarioKeyForView(
  state: ScenarioSelectionState,
  view: DemoNavKey,
): string {
  if (view === 'editor') {
    return state.editorScenarioKey;
  }
  if (view === 'viewer') {
    return state.viewerScenarioKey;
  }
  return state.diffScenarioKey;
}

export function updateScenarioForActiveView(
  state: ScenarioSelectionState,
  activeView: DemoNavKey,
  nextScenarioKey: string,
): ScenarioSelectionState {
  if (activeView === 'editor') {
    return {
      ...state,
      editorScenarioKey: nextScenarioKey,
    };
  }
  if (activeView === 'viewer') {
    return {
      ...state,
      viewerScenarioKey: nextScenarioKey,
    };
  }
  return {
    ...state,
    diffScenarioKey: nextScenarioKey,
  };
}
