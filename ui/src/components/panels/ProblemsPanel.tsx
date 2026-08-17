import { useState } from 'react';
import { type ValidationProblem } from '../../types/validation.ts';
import './ProblemsPanel.css';

interface ProblemsPanelProps {
  problems: ValidationProblem[];
  onProblemClick: (problem: ValidationProblem) => void;
}

export function ProblemsPanel({ problems, onProblemClick }: ProblemsPanelProps) {
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
            <li key={`${p.code}-${p.nodeId ?? p.edgeId ?? i}`} className="problems-panel__item" onClick={() => onProblemClick(p)}>
              <span className={p.severity === 'error' ? 'problems-panel__severity-error' : 'problems-panel__severity-warning'}>
                {p.severity === 'error' ? 'E' : 'W'}
              </span>
              <span className="problems-panel__code">{p.code}</span>
              <span>{p.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
