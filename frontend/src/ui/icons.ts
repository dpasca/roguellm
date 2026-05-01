export function normalizeFontAwesomeClass(iconClass: string | undefined, fallback: string): string {
  const source = iconClass?.trim() || fallback;
  const classes = source
    .split(/\s+/)
    .filter((part) => /^(fa|fas|far|fab|fa-solid|fa-regular|fa-brands|fa-[a-z0-9-]+)$/i.test(part));

  if (!classes.some((part) => part === 'fa' || part === 'fas' || part === 'fa-solid')) {
    classes.unshift('fa-solid');
  }

  return classes.length > 0 ? classes.join(' ') : fallback;
}
