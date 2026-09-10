import { describe, expect, it } from 'vitest';

import {
  createScenarioSelectionState,
  getScenarioKeyForView,
  updateScenarioForActiveView,
  type ScenarioSelectionState,
} from './scenarioSelectionState.ts';

describe('scenario selection state', () => {
  it('updates only editor scenario when editor view is active', () => {
    const state: ScenarioSelectionState = createScenarioSelectionState('cve-triage', 'semantic-and-cosmetic');

    const nextState = updateScenarioForActiveView(state, 'editor', 'parallel-fork-join');

    expect(nextState.editorScenarioKey).toBe('parallel-fork-join');
    expect(nextState.viewerScenarioKey).toBe('cve-triage');
    expect(nextState.diffScenarioKey).toBe('semantic-and-cosmetic');
  });

  it('updates only viewer scenario when viewer view is active', () => {
    const state: ScenarioSelectionState = {
      editorScenarioKey: 'parallel-fork-join',
      viewerScenarioKey: 'cve-triage',
      diffScenarioKey: 'semantic-and-cosmetic',
    };

    const nextState = updateScenarioForActiveView(state, 'viewer', 'loop-review');

    expect(nextState.editorScenarioKey).toBe('parallel-fork-join');
    expect(nextState.viewerScenarioKey).toBe('loop-review');
    expect(nextState.diffScenarioKey).toBe('semantic-and-cosmetic');
  });

  it('updates only diff scenario when diff view is active', () => {
    const state: ScenarioSelectionState = {
      editorScenarioKey: 'parallel-fork-join',
      viewerScenarioKey: 'cve-triage',
      diffScenarioKey: 'semantic-and-cosmetic',
    };

    const nextState = updateScenarioForActiveView(state, 'diff', 'add-remove');

    expect(nextState.editorScenarioKey).toBe('parallel-fork-join');
    expect(nextState.viewerScenarioKey).toBe('cve-triage');
    expect(nextState.diffScenarioKey).toBe('add-remove');
  });

  it('selects scenario key based on active view', () => {
    const state: ScenarioSelectionState = {
      editorScenarioKey: 'parallel-fork-join',
      viewerScenarioKey: 'loop-review',
      diffScenarioKey: 'add-remove',
    };

    expect(getScenarioKeyForView(state, 'editor')).toBe('parallel-fork-join');
    expect(getScenarioKeyForView(state, 'viewer')).toBe('loop-review');
    expect(getScenarioKeyForView(state, 'diff')).toBe('add-remove');
  });
});
