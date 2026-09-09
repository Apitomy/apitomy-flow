import { type DemoNavKey } from './navigationModel.ts';

export interface ScenarioSelectionState {
  editorScenarioKey: string;
  viewerScenarioKey: string;
}

export function createScenarioSelectionState(defaultScenarioKey: string): ScenarioSelectionState {
  return {
    editorScenarioKey: defaultScenarioKey,
    viewerScenarioKey: defaultScenarioKey,
  };
}

export function getScenarioKeyForView(
  state: ScenarioSelectionState,
  view: DemoNavKey,
): string {
  return view === 'editor' ? state.editorScenarioKey : state.viewerScenarioKey;
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
  return {
    ...state,
    viewerScenarioKey: nextScenarioKey,
  };
}
