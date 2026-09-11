import { type FlowTheme } from '../components/WorkflowEditor.tsx';

const patternFlyDarkRootClass = 'pf-v6-theme-dark';

export function syncPatternFlyRootTheme(
  theme: FlowTheme,
  classList: Pick<DOMTokenList, 'toggle'> | undefined = globalThis.document?.documentElement?.classList,
): void {
  classList?.toggle(patternFlyDarkRootClass, theme === 'dark');
}
