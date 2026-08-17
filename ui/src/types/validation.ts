export type ValidationSeverity = 'error' | 'warning';

export interface ValidationProblem {
  severity: ValidationSeverity;
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}
