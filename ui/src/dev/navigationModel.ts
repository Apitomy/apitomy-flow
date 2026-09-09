export type DemoNavKey = 'editor' | 'viewer';

export interface DemoNavItem {
  key: DemoNavKey;
  label: string;
}

export const demoNavItems: DemoNavItem[] = [
  { key: 'editor', label: 'Editor Demo' },
  { key: 'viewer', label: 'Viewer Demo' },
];
