const fontAwesomeStyleClasses = new Set([
  'fa',
  'fas',
  'far',
  'fab',
  'fa-solid',
  'fa-regular',
  'fa-brands'
]);

export function normalizeFontAwesomeClass(iconClass: string | undefined, fallback: string): string {
  const source = iconClass?.trim() || fallback;
  const classes = source
    .split(/\s+/)
    .filter((part) => /^(fa|fas|far|fab|fa-solid|fa-regular|fa-brands|fa-[a-z0-9-]+)$/i.test(part));

  const hasIconClass = classes.some((part) => {
    const normalized = part.toLowerCase();
    return normalized.startsWith('fa-') && !fontAwesomeStyleClasses.has(normalized);
  });
  if (!hasIconClass) {
    return fallback;
  }

  if (!classes.some((part) => part === 'fa' || part === 'fas' || part === 'fa-solid')) {
    classes.unshift('fa-solid');
  }

  return classes.join(' ');
}
