export interface ContentSectionConfig {
  isFilled: boolean;
  hasBodyWrapper: boolean;
}

export function getContentSectionConfig(): ContentSectionConfig {
  return {
    isFilled: true,
    hasBodyWrapper: false,
  };
}
