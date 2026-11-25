import { createHash } from 'node:crypto';

export function endpointSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
    .replace(/-+$/g, '');
  return slug || 'endpoint';
}

export function newEndpointId(name: string, requestId: string): string {
  const hex = createHash('sha256').update(requestId).digest('hex').slice(0, 6);
  return `custom-${endpointSlug(name)}-${hex}`;
}
