export const DEFAULT_SETTINGS = {
  source: 'zheshang',
  backgroundColor: '#333333',
  opacity: 50,
  alertPrice: '',
  priceFontSize: 29,
  baselineFontSize: 17,
};

export function normalizeSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    opacity: clamp(Number(settings?.opacity ?? DEFAULT_SETTINGS.opacity), 0, 100),
    priceFontSize: clamp(Number(settings?.priceFontSize ?? DEFAULT_SETTINGS.priceFontSize), 0, 50),
    baselineFontSize: clamp(Number(settings?.baselineFontSize ?? DEFAULT_SETTINGS.baselineFontSize), 0, 50),
    backgroundColor: normalizeColor(settings?.backgroundColor),
    alertPrice: settings?.alertPrice ?? '',
    source: settings?.source === 'sina' ? 'sina' : 'zheshang',
  };
}

function normalizeColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value ?? '') ? value : DEFAULT_SETTINGS.backgroundColor;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
