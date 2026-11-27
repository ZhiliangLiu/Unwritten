export type NavigationDecision = { action: 'allow' } | { action: 'external'; url: string } | { action: 'drop' };

export function decideNavigation(target: string, allowed: string): NavigationDecision {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { action: 'drop' };
  }

  if (url.origin === allowed) return { action: 'allow' };
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return { action: 'external', url: url.href };
  }
  return { action: 'drop' };
}

export function decideWindowOpen(target: string, allowed: string): Exclude<NavigationDecision, { action: 'allow' }> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { action: 'drop' };
  }

  if (url.origin === allowed) return { action: 'drop' };
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return { action: 'external', url: url.href };
  }
  return { action: 'drop' };
}
