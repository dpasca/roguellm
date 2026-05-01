export function parseHexColor(hexColor: string | undefined, fallback = 0x333333): number {
  if (!hexColor) {
    return fallback;
  }

  const normalized = hexColor.replace('#', '').trim();
  if (normalized.length !== 6) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 16);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function scaleRgb(color: number, scale: number): number {
  const r = Math.max(0, Math.min(255, Math.floor(((color >> 16) & 0xff) * scale)));
  const g = Math.max(0, Math.min(255, Math.floor(((color >> 8) & 0xff) * scale)));
  const b = Math.max(0, Math.min(255, Math.floor((color & 0xff) * scale)));
  return (r << 16) | (g << 8) | b;
}
