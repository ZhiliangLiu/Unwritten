export function readCssDuration(name: `--uw-${string}`, element: Element = document.documentElement): number {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  if (value.endsWith('ms')) {
    const milliseconds = Number(value.slice(0, -2));
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  }
  if (value.endsWith('s')) {
    const seconds = Number(value.slice(0, -1));
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
  }
  return 0;
}
