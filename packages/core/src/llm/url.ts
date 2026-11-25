const TRAILING_SEGMENTS = ['/chat/completions', '/completions', '/models', '/messages'];

export function normalizeBaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search) return null;
  let path = url.pathname;
  let changed = true;
  while (changed) {
    changed = false;
    path = path.replace(/\/+$/, '');
    for (const segment of TRAILING_SEGMENTS) {
      if (path.endsWith(segment)) {
        path = path.slice(0, -segment.length);
        changed = true;
      }
    }
  }
  return `${url.origin}${path}`;
}
