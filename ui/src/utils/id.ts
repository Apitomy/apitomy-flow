let counter = 0;

export function generateNodeId(type: string): string {
  return `${type}-${Date.now()}-${++counter}`;
}

export function generateEdgeId(source: string, target: string): string {
  return `e-${source}-${target}-${Date.now()}-${++counter}`;
}
