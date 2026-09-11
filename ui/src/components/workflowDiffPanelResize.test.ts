import { describe, it, expect } from 'vitest';
import { clampDetailPanelWidth } from './workflowDiffPanelResize.ts';

describe('clampDetailPanelWidth', () => {
  it('grows panel width when dragging handle left', () => {
    const width = clampDetailPanelWidth(320, 500, 450);
    expect(width).toBe(370);
  });

  it('shrinks panel width when dragging handle right', () => {
    const width = clampDetailPanelWidth(320, 500, 530);
    expect(width).toBe(290);
  });

  it('clamps to minimum width', () => {
    const width = clampDetailPanelWidth(220, 500, 900);
    expect(width).toBe(200);
  });

  it('clamps to maximum width', () => {
    const width = clampDetailPanelWidth(580, 500, 50);
    expect(width).toBe(600);
  });
});
