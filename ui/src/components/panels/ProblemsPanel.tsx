import { useState } from 'react';
import { type ValidationProblem } from '../../types/validation.ts';
import './ProblemsPanel.css';

interface ProblemsPanelProps {
  problems: ValidationProblem[];
  onProblemClick: (problem: ValidationProblem) => void;
  /** Opens the host actions menu for a row; returns true when a menu opened. */
  onProblemMenu?: (problem: ValidationProblem, screenPosition: { x: number; y: number }, opener: HTMLElement) => boolean;
  /** When provided, every row gets an actions button, enabled when this returns true. */
  problemMenuEnabled?: (problem: ValidationProblem) => boolean;
}

export function ProblemsPanel({ problems, onProblemClick, onProblemMenu, problemMenuEnabled }: ProblemsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const errors = problems.filter(p => p.severity === 'error');
  const warnings = problems.filter(p => p.severity === 'warning');
  const sorted = [...errors, ...warnings];

  return (
    <div className="problems-panel">
      <div className="problems-panel__header" onClick={() => setCollapsed(!collapsed)}>
        <span>Problems</span>
        <div className="problems-panel__count">
          {errors.length > 0 && <span className="problems-panel__count-error">{errors.length} errors</span>}
          {warnings.length > 0 && <span className="problems-panel__count-warning">{warnings.length} warnings</span>}
          {problems.length === 0 && <span>No problems</span>}
        </div>
      </div>
      {!collapsed && sorted.length > 0 && (
        <ul className="problems-panel__list">
          {sorted.map((p, i) => (
            <li key={`${p.code}-${p.nodeId ?? p.edgeId ?? i}`} className="problems-panel__item" onClick={() => onProblemClick(p)}
              onContextMenu={event => {
                if (onProblemMenu?.(p, { x: event.clientX, y: event.clientY }, event.currentTarget)) event.preventDefault();
              }}>
              <span className={p.severity === 'error' ? 'problems-panel__severity-error' : 'problems-panel__severity-warning'}>
                {p.severity === 'error' ? 'E' : 'W'}
              </span>
              <span className="problems-panel__code">{p.code}</span>
              <span>{p.message}</span>
              {problemMenuEnabled && (
                <button type="button" className="problems-panel__menu" aria-label={`Actions for ${p.code}`}
                  aria-haspopup="menu" disabled={!problemMenuEnabled(p)}
                  onClick={event => {
                    event.stopPropagation();
                    const box = event.currentTarget.getBoundingClientRect();
                    onProblemMenu?.(p, { x: box.left, y: box.bottom }, event.currentTarget);
                  }}>
                  ⋯
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
